//! Realtime connections: raw WebSocket and Socket.IO (Engine.IO v4 over the
//! websocket transport).
//!
//! Each connection runs as a Tokio task and reports [`RealtimeEvent`]s
//! through a caller-provided sink; the UI holds a [`RealtimeHandle`] to send
//! messages or close. Nothing here touches the UI thread.

pub mod socketio;
pub mod websocket;

use std::sync::Arc;

use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnStatus {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
}

impl ConnStatus {
    pub fn label(self) -> &'static str {
        match self {
            ConnStatus::Connecting => "Connecting",
            ConnStatus::Connected => "Connected",
            ConnStatus::Reconnecting => "Reconnecting",
            ConnStatus::Disconnected => "Disconnected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    In,
    Out,
    System,
}

#[derive(Debug, Clone)]
pub struct RealtimeMessage {
    pub direction: Direction,
    pub text: String,
    /// Socket.IO event name
    pub event: Option<String>,
    pub binary: bool,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone)]
pub enum RealtimeEventKind {
    Status(ConnStatus, Option<String>),
    Message(RealtimeMessage),
}

#[derive(Debug, Clone)]
pub struct RealtimeEvent {
    /// Caller-chosen id (tab id) so late events can be routed or dropped.
    pub conn_id: String,
    /// Monotonic connection generation; events from an older generation are stale.
    pub generation: u64,
    pub kind: RealtimeEventKind,
}

pub type EventSink = Arc<dyn Fn(RealtimeEvent) + Send + Sync>;

#[derive(Debug, Clone)]
pub enum Command {
    Text(String),
    Binary(Vec<u8>),
    /// Socket.IO emit: event, JSON or text payload
    Emit { event: String, payload: String },
    Ping,
    Close,
}

/// Handle used by the UI to drive a live connection.
#[derive(Clone)]
pub struct RealtimeHandle {
    pub(crate) tx: mpsc::UnboundedSender<Command>,
}

impl RealtimeHandle {
    pub fn send(&self, cmd: Command) -> bool {
        self.tx.send(cmd).is_ok()
    }
    pub fn close(&self) {
        let _ = self.tx.send(Command::Close);
    }
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }
}

pub(crate) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) struct Emitter {
    pub conn_id: String,
    pub generation: u64,
    pub sink: EventSink,
}

impl Emitter {
    pub fn status(&self, s: ConnStatus, detail: Option<String>) {
        (self.sink)(RealtimeEvent { conn_id: self.conn_id.clone(), generation: self.generation, kind: RealtimeEventKind::Status(s, detail) });
    }
    pub fn msg(&self, direction: Direction, text: impl Into<String>, event: Option<String>, binary: bool) {
        (self.sink)(RealtimeEvent {
            conn_id: self.conn_id.clone(),
            generation: self.generation,
            kind: RealtimeEventKind::Message(RealtimeMessage { direction, text: text.into(), event, binary, timestamp_ms: now_ms() }),
        });
    }
    pub fn sys(&self, text: impl Into<String>) {
        self.msg(Direction::System, text, None, false);
    }
}

/// Normalise http(s)/ws(s)/bare URLs to a websocket URL.
pub fn to_ws_url(raw: &str) -> String {
    let url = raw.trim();
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("https://") {
        format!("wss://{}", &url[8..])
    } else if lower.starts_with("http://") {
        format!("ws://{}", &url[7..])
    } else if lower.starts_with("ws://") || lower.starts_with("wss://") {
        url.to_string()
    } else {
        format!("wss://{url}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_urls() {
        assert_eq!(to_ws_url("https://a.io/x"), "wss://a.io/x");
        assert_eq!(to_ws_url("http://a.io"), "ws://a.io");
        assert_eq!(to_ws_url("a.io"), "wss://a.io");
        assert_eq!(to_ws_url("ws://a.io"), "ws://a.io");
    }
}
