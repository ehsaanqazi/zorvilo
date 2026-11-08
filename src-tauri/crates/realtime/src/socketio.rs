//! Socket.IO v4 client over the Engine.IO v4 websocket transport.
//!
//! Supported: handshake, ping/pong with timeout detection, namespaces,
//! connect auth payload, emit, event reception, server-requested acks
//! (answered with an empty ack), CONNECT_ERROR, server disconnect and
//! automatic reconnection with backoff.
//!
//! Not supported: the HTTP long-polling transport, binary events/acks
//! (packets 5 and 6 are logged but attachments are not decoded), and
//! client-side ack callbacks.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::websocket::{handshake_request, wait_for_close};
use crate::{to_ws_url, Command, ConnStatus, Direction, Emitter, EventSink, RealtimeHandle};

#[derive(Debug, Clone)]
pub struct SocketIoOptions {
    pub url: String,
    /// "/" or "/admin"
    pub namespace: String,
    /// optional JSON object sent with CONNECT
    pub auth: String,
    pub headers: Vec<(String, String)>,
    pub reconnect: bool,
    pub max_attempts: u32,
}

impl Default for SocketIoOptions {
    fn default() -> Self {
        Self { url: String::new(), namespace: "/".into(), auth: String::new(), headers: Vec::new(), reconnect: true, max_attempts: 5 }
    }
}

/// A decoded Socket.IO packet (inside an Engine.IO "message" packet).
#[derive(Debug, Clone, PartialEq)]
pub struct SioPacket {
    pub kind: u8,
    pub namespace: String,
    pub ack_id: Option<u64>,
    pub data: Option<serde_json::Value>,
    pub raw_data: String,
}

/// Parse the Socket.IO part of a frame (text after the Engine.IO '4').
pub fn parse_sio(text: &str) -> Option<SioPacket> {
    let mut chars = text.chars();
    let kind = chars.next()?.to_digit(10)? as u8;
    let mut rest: &str = &text[1..];
    if kind == 5 || kind == 6 {
        // binary: "<attachments>-" prefix
        if let Some(dash) = rest.find('-') {
            rest = &rest[dash + 1..];
        }
    }
    let mut namespace = "/".to_string();
    if rest.starts_with('/') {
        match rest.find(',') {
            Some(i) => {
                namespace = rest[..i].to_string();
                rest = &rest[i + 1..];
            }
            None => {
                namespace = rest.to_string();
                rest = "";
            }
        }
    }
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let ack_id = if digits.is_empty() { None } else { digits.parse().ok() };
    rest = &rest[digits.len()..];
    let data = if rest.is_empty() { None } else { serde_json::from_str(rest).ok() };
    Some(SioPacket { kind, namespace, ack_id, data, raw_data: rest.to_string() })
}

fn ns_prefix(ns: &str) -> String {
    if ns.is_empty() || ns == "/" {
        String::new()
    } else {
        format!("{ns},")
    }
}

/// Encode an EVENT frame (Engine.IO message + Socket.IO event).
pub fn encode_emit(ns: &str, event: &str, payload: &str) -> String {
    let value: serde_json::Value =
        serde_json::from_str(payload).unwrap_or_else(|_| serde_json::Value::String(payload.to_string()));
    let arr = serde_json::Value::Array(vec![serde_json::Value::String(event.to_string()), value]);
    format!("42{}{}", ns_prefix(ns), arr)
}

/// Build ws(s)://host/<path>/?EIO=4&transport=websocket keeping custom paths and query.
pub fn engine_url(raw: &str) -> Result<String, String> {
    let ws = to_ws_url(raw);
    let mut url = url::Url::parse(&ws).map_err(|e| format!("invalid URL: {e}"))?;
    let path = url.path().trim_end_matches('/').to_string();
    let path = if path.is_empty() { "/socket.io".to_string() } else { path };
    url.set_path(&format!("{path}/"));
    let extra: Vec<(String, String)> =
        url.query_pairs().filter(|(k, _)| k != "EIO" && k != "transport").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    {
        let mut q = url.query_pairs_mut();
        q.clear();
        for (k, v) in &extra {
            q.append_pair(k, v);
        }
        q.append_pair("EIO", "4");
        q.append_pair("transport", "websocket");
    }
    Ok(url.to_string())
}

pub fn connect(
    rt: &tokio::runtime::Handle,
    conn_id: String,
    generation: u64,
    opts: SocketIoOptions,
    sink: EventSink,
) -> RealtimeHandle {
    let (tx, rx) = mpsc::unbounded_channel();
    let em = Emitter { conn_id, generation, sink };
    rt.spawn(run(em, opts, rx));
    RealtimeHandle { tx }
}

enum SessionEnd {
    /// user closed — stop
    UserClosed,
    /// transport failure — may reconnect
    Lost(String),
    /// server ended the namespace — stop
    ServerClosed,
}

async fn run(em: Emitter, opts: SocketIoOptions, mut rx: mpsc::UnboundedReceiver<Command>) {
    let mut attempt = 0u32;
    loop {
        em.status(if attempt == 0 { ConnStatus::Connecting } else { ConnStatus::Reconnecting }, None);
        let end = session(&em, &opts, &mut rx).await;
        match end {
            SessionEnd::UserClosed | SessionEnd::ServerClosed => break,
            SessionEnd::Lost(reason) => {
                em.sys(format!("Connection lost: {reason}"));
                if !opts.reconnect || attempt >= opts.max_attempts {
                    break;
                }
                attempt += 1;
                let delay = Duration::from_millis((500u64 << attempt.min(4)).min(5000));
                em.status(ConnStatus::Reconnecting, Some(format!("attempt {attempt}/{}", opts.max_attempts)));
                em.sys(format!("Reconnecting in {} ms (attempt {attempt}/{})", delay.as_millis(), opts.max_attempts));
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = wait_for_close(&mut rx) => break,
                }
            }
        }
    }
    em.status(ConnStatus::Disconnected, None);
}

async fn session(em: &Emitter, opts: &SocketIoOptions, rx: &mut mpsc::UnboundedReceiver<Command>) -> SessionEnd {
    let target = match engine_url(&opts.url) {
        Ok(t) => t,
        Err(e) => {
            em.sys(e);
            return SessionEnd::ServerClosed;
        }
    };
    let request = match handshake_request(&target, &opts.headers) {
        Ok(r) => r,
        Err(e) => {
            em.sys(e);
            return SessionEnd::ServerClosed;
        }
    };
    let connected = tokio::select! {
        r = tokio_tungstenite::connect_async(request) => r,
        _ = wait_for_close(rx) => return SessionEnd::UserClosed,
    };
    let (stream, _) = match connected {
        Ok(s) => s,
        Err(e) => return SessionEnd::Lost(e.to_string()),
    };
    em.sys(format!("Transport open ({target}) — waiting for Engine.IO handshake…"));
    let (mut write, mut read) = stream.split();
    let ns = if opts.namespace.trim().is_empty() { "/".to_string() } else { opts.namespace.trim().to_string() };
    let mut sio_connected = false;
    let mut heartbeat = Duration::from_secs(45);
    let deadline = tokio::time::sleep(heartbeat);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                return SessionEnd::Lost("ping timeout".into());
            }
            cmd = rx.recv() => match cmd {
                None | Some(Command::Close) => {
                    let _ = write.send(Message::Text(format!("41{}", ns_prefix(&ns)))).await;
                    let _ = write.send(Message::Close(None)).await;
                    em.sys("Disconnected by client");
                    return SessionEnd::UserClosed;
                }
                Some(Command::Emit { event, payload }) => {
                    if !sio_connected {
                        em.sys("Not connected yet — message not sent");
                        continue;
                    }
                    let frame = encode_emit(&ns, if event.trim().is_empty() { "message" } else { event.trim() }, &payload);
                    if write.send(Message::Text(frame)).await.is_ok() {
                        em.msg(Direction::Out, payload, Some(if event.trim().is_empty() { "message".into() } else { event.trim().to_string() }), false);
                    }
                }
                Some(Command::Text(t)) => {
                    let frame = encode_emit(&ns, "message", &t);
                    if sio_connected && write.send(Message::Text(frame)).await.is_ok() {
                        em.msg(Direction::Out, t, Some("message".into()), false);
                    }
                }
                Some(Command::Binary(_)) => em.sys("Binary emits are not supported for Socket.IO"),
                Some(Command::Ping) => em.sys("Socket.IO heartbeats are server driven"),
            },
            msg = read.next() => {
                let text = match msg {
                    None => return SessionEnd::Lost("transport closed".into()),
                    Some(Err(e)) => return SessionEnd::Lost(e.to_string()),
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Binary(b))) => { em.sys(format!("Binary attachment ({} bytes) ignored", b.len())); continue; }
                    Some(Ok(Message::Close(_))) => return SessionEnd::Lost("server closed the transport".into()),
                    Some(Ok(_)) => continue,
                };
                let Some(kind) = text.chars().next() else { continue };
                match kind {
                    '0' => {
                        // open: {"sid","pingInterval","pingTimeout"}
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text[1..]) {
                            let interval = v["pingInterval"].as_u64().unwrap_or(25_000);
                            let timeout = v["pingTimeout"].as_u64().unwrap_or(20_000);
                            heartbeat = Duration::from_millis(interval + timeout);
                            deadline.as_mut().reset(tokio::time::Instant::now() + heartbeat);
                        }
                        let auth = opts.auth.trim();
                        let frame = if auth.is_empty() { format!("40{}", ns_prefix(&ns)) } else { format!("40{}{}", ns_prefix(&ns), auth) };
                        if write.send(Message::Text(frame)).await.is_err() {
                            return SessionEnd::Lost("could not send CONNECT".into());
                        }
                    }
                    '1' => return SessionEnd::Lost("Engine.IO close".into()),
                    '2' => {
                        deadline.as_mut().reset(tokio::time::Instant::now() + heartbeat);
                        let _ = write.send(Message::Text("3".into())).await;
                    }
                    '4' => {
                        let Some(p) = parse_sio(&text[1..]) else { continue };
                        if p.namespace != ns {
                            continue;
                        }
                        match p.kind {
                            0 => {
                                sio_connected = true;
                                em.status(ConnStatus::Connected, None);
                                em.sys(format!("Socket.IO connected (namespace {ns})"));
                            }
                            1 => {
                                em.sys("Server closed the namespace");
                                return SessionEnd::ServerClosed;
                            }
                            2 => {
                                let (event, args) = match p.data {
                                    Some(serde_json::Value::Array(mut a)) if !a.is_empty() => {
                                        let ev = a.remove(0);
                                        (ev.as_str().map(str::to_string).unwrap_or_else(|| ev.to_string()), a)
                                    }
                                    _ => ("message".to_string(), Vec::new()),
                                };
                                let shown = if args.len() == 1 { args[0].clone() } else { serde_json::Value::Array(args) };
                                let text = serde_json::to_string_pretty(&shown).unwrap_or_default();
                                em.msg(Direction::In, text, Some(event), false);
                                if let Some(id) = p.ack_id {
                                    let _ = write.send(Message::Text(format!("43{}{id}[]", ns_prefix(&ns)))).await;
                                }
                            }
                            3 => em.sys(format!("Ack received: {}", p.raw_data)),
                            4 => {
                                em.sys(format!("Connection error: {}", p.raw_data));
                                return SessionEnd::ServerClosed;
                            }
                            5 | 6 => em.sys("Binary event received (attachments are not decoded)"),
                            _ => {}
                        }
                    }
                    '6' => {} // noop (upgrade)
                    _ => em.sys(format!("Unknown frame: {text}")),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_event_with_namespace_and_ack() {
        let p = parse_sio(r#"2/admin,12["hello",{"a":1}]"#).unwrap();
        assert_eq!(p.kind, 2);
        assert_eq!(p.namespace, "/admin");
        assert_eq!(p.ack_id, Some(12));
        assert_eq!(p.data.unwrap()[0], "hello");
    }

    #[test]
    fn parse_connect_default_ns() {
        let p = parse_sio(r#"0{"sid":"x"}"#).unwrap();
        assert_eq!(p.kind, 0);
        assert_eq!(p.namespace, "/");
        assert_eq!(p.ack_id, None);
    }

    #[test]
    fn encode() {
        assert_eq!(encode_emit("/", "ev", r#"{"a":1}"#), r#"42["ev",{"a":1}]"#);
        assert_eq!(encode_emit("/chat", "ev", "hi"), r#"42/chat,["ev","hi"]"#);
    }

    #[test]
    fn engine_urls() {
        assert_eq!(engine_url("https://h.io").unwrap(), "wss://h.io/socket.io/?EIO=4&transport=websocket");
        assert_eq!(engine_url("http://h.io/custom/?token=1").unwrap(), "ws://h.io/custom/?token=1&EIO=4&transport=websocket");
    }
}
