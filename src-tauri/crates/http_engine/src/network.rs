//! Destination safety checks (loopback / private / link-local detection)
//! with DNS pinning to mitigate rebinding between check and connect.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressClass {
    Public,
    Loopback,
    Private,
    LinkLocal,
    /// cloud metadata endpoints such as 169.254.169.254
    Metadata,
    Unspecified,
}

impl AddressClass {
    pub fn is_internal(self) -> bool {
        !matches!(self, AddressClass::Public)
    }
    pub fn describe(self) -> &'static str {
        match self {
            AddressClass::Public => "public address",
            AddressClass::Loopback => "loopback (this machine)",
            AddressClass::Private => "private network address",
            AddressClass::LinkLocal => "link-local address",
            AddressClass::Metadata => "cloud metadata endpoint",
            AddressClass::Unspecified => "unspecified address",
        }
    }
}

fn classify_v4(ip: Ipv4Addr) -> AddressClass {
    let o = ip.octets();
    if ip == Ipv4Addr::new(169, 254, 169, 254) {
        AddressClass::Metadata
    } else if ip.is_loopback() {
        AddressClass::Loopback
    } else if ip.is_unspecified() {
        AddressClass::Unspecified
    } else if ip.is_link_local() {
        AddressClass::LinkLocal
    } else if ip.is_private() || (o[0] == 100 && (64..=127).contains(&o[1])) {
        // RFC1918 + carrier-grade NAT
        AddressClass::Private
    } else {
        AddressClass::Public
    }
}

fn classify_v6(ip: Ipv6Addr) -> AddressClass {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return classify_v4(v4);
    }
    let seg = ip.segments();
    if ip.is_loopback() {
        AddressClass::Loopback
    } else if ip.is_unspecified() {
        AddressClass::Unspecified
    } else if (seg[0] & 0xffc0) == 0xfe80 {
        AddressClass::LinkLocal
    } else if (seg[0] & 0xfe00) == 0xfc00 {
        AddressClass::Private
    } else if seg == [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254] {
        AddressClass::Metadata
    } else {
        AddressClass::Public
    }
}

pub fn classify(ip: IpAddr) -> AddressClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

/// Outcome of resolving and checking a destination.
#[derive(Debug, Clone, Default)]
pub struct DestinationCheck {
    /// Addresses to pin the connection to (empty = let the client resolve).
    pub pinned: Vec<SocketAddr>,
    pub warning: Option<String>,
    pub internal: bool,
}

/// Resolve `host` and classify every address. The resolved addresses are
/// returned so the HTTP client connects to exactly what was checked.
pub async fn check_destination(host: &str, port: u16) -> Result<DestinationCheck, String> {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<IpAddr>() {
        let class = classify(ip);
        return Ok(DestinationCheck {
            pinned: Vec::new(),
            warning: class.is_internal().then(|| format!("{host} is a {}", class.describe())),
            internal: class.is_internal(),
        });
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((bare, port))
        .await
        .map_err(|e| format!("DNS lookup for {host} failed: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("DNS lookup for {host} returned no addresses"));
    }
    let internal: Vec<_> = addrs.iter().map(|a| classify(a.ip())).filter(|c| c.is_internal()).collect();
    let warning = internal.first().map(|c| format!("{host} resolves to a {}", c.describe()));
    Ok(DestinationCheck { pinned: addrs, internal: warning.is_some(), warning })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification() {
        assert_eq!(classify("127.0.0.1".parse().unwrap()), AddressClass::Loopback);
        assert_eq!(classify("10.1.2.3".parse().unwrap()), AddressClass::Private);
        assert_eq!(classify("172.20.0.1".parse().unwrap()), AddressClass::Private);
        assert_eq!(classify("192.168.1.1".parse().unwrap()), AddressClass::Private);
        assert_eq!(classify("169.254.169.254".parse().unwrap()), AddressClass::Metadata);
        assert_eq!(classify("169.254.1.1".parse().unwrap()), AddressClass::LinkLocal);
        assert_eq!(classify("100.64.0.1".parse().unwrap()), AddressClass::Private);
        assert_eq!(classify("8.8.8.8".parse().unwrap()), AddressClass::Public);
        assert_eq!(classify("::1".parse().unwrap()), AddressClass::Loopback);
        assert_eq!(classify("fe80::1".parse().unwrap()), AddressClass::LinkLocal);
        assert_eq!(classify("fd12::1".parse().unwrap()), AddressClass::Private);
        assert_eq!(classify("::ffff:10.0.0.1".parse().unwrap()), AddressClass::Private);
    }
}
