//! Plain WebSocket client (text, binary, ping/pong, custom headers).

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

use crate::{to_ws_url, Command, ConnStatus, Direction, Emitter, EventSink, RealtimeHandle};

#[derive(Debug, Clone, Default)]
pub struct WsOptions {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

/// Build a websocket handshake request with extra headers.
pub(crate) fn handshake_request(
    url: &str,
    headers: &[(String, String)],
) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    let mut request = url.into_client_request().map_err(|e| format!("invalid URL {url}: {e}"))?;
    for (k, v) in headers {
        if k.trim().is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(k.trim().as_bytes()).map_err(|_| format!("invalid header name {k}"))?;
        let value = HeaderValue::from_str(v).map_err(|_| format!("invalid value for header {k}"))?;
        request.headers_mut().insert(name, value);
    }
    Ok(request)
}

pub(crate) fn binary_preview(b: &[u8]) -> String {
    let hex: Vec<String> = b.iter().take(32).map(|x| format!("{x:02x}")).collect();
    format!("(binary {} bytes) {}{}", b.len(), hex.join(" "), if b.len() > 32 { " …" } else { "" })
}

/// Connect on the given runtime; events are delivered through `sink`.
pub fn connect(
    rt: &tokio::runtime::Handle,
    conn_id: String,
    generation: u64,
    opts: WsOptions,
    sink: EventSink,
) -> RealtimeHandle {
    let (tx, rx) = mpsc::unbounded_channel();
    let em = Emitter { conn_id, generation, sink };
    rt.spawn(run(em, opts, rx));
    RealtimeHandle { tx }
}

async fn run(em: Emitter, opts: WsOptions, mut rx: mpsc::UnboundedReceiver<Command>) {
    em.status(ConnStatus::Connecting, None);
    let url = to_ws_url(&opts.url);
    let request = match handshake_request(&url, &opts.headers) {
        Ok(r) => r,
        Err(e) => {
            em.sys(e.clone());
            em.status(ConnStatus::Disconnected, Some(e));
            return;
        }
    };
    let stream = tokio::select! {
        r = tokio_tungstenite::connect_async(request) => r,
        _ = wait_for_close(&mut rx) => {
            em.status(ConnStatus::Disconnected, Some("cancelled".into()));
            return;
        }
    };
    let (stream, response) = match stream {
        Ok(s) => s,
        Err(e) => {
            em.sys(format!("Connection failed: {e}"));
            em.status(ConnStatus::Disconnected, Some(e.to_string()));
            return;
        }
    };
    em.status(ConnStatus::Connected, None);
    em.sys(format!("Connected to {url} (HTTP {})", response.status().as_u16()));
    let (mut write, mut read) = stream.split();

    loop {
        tokio::select! {
            cmd = rx.recv() => match cmd {
                None | Some(Command::Close) => {
                    let _ = write.send(Message::Close(None)).await;
                    em.sys("Disconnected by client");
                    break;
                }
                Some(Command::Text(t)) | Some(Command::Emit { payload: t, .. }) => {
                    match write.send(Message::Text(t.clone())).await {
                        Ok(()) => em.msg(Direction::Out, t, None, false),
                        Err(e) => { em.sys(format!("Send failed: {e}")); break; }
                    }
                }
                Some(Command::Binary(b)) => {
                    let preview = binary_preview(&b);
                    match write.send(Message::Binary(b)).await {
                        Ok(()) => em.msg(Direction::Out, preview, None, true),
                        Err(e) => { em.sys(format!("Send failed: {e}")); break; }
                    }
                }
                Some(Command::Ping) => {
                    if write.send(Message::Ping(b"zorvilo".to_vec())).await.is_ok() {
                        em.sys("Ping sent");
                    }
                }
            },
            msg = read.next() => match msg {
                None => { em.sys("Connection closed"); break; }
                Some(Err(e)) => { em.sys(format!("Socket error: {e}")); break; }
                Some(Ok(m)) => match m {
                    Message::Text(t) => em.msg(Direction::In, t, None, false),
                    Message::Binary(b) => em.msg(Direction::In, binary_preview(&b), None, true),
                    Message::Ping(_) => em.sys("Ping received (pong sent)"),
                    Message::Pong(_) => em.sys("Pong received"),
                    Message::Close(frame) => {
                        match frame {
                            Some(f) => em.sys(format!("Closed by server (code {}{})", u16::from(f.code), if f.reason.is_empty() { String::new() } else { format!(", {}", f.reason) })),
                            None => em.sys("Closed by server"),
                        }
                        break;
                    }
                    Message::Frame(_) => {}
                },
            },
        }
    }
    em.status(ConnStatus::Disconnected, None);
}

/// Resolves when the UI asks to close (or drops the handle) before connect completes.
pub(crate) async fn wait_for_close(rx: &mut mpsc::UnboundedReceiver<Command>) {
    loop {
        match rx.recv().await {
            None | Some(Command::Close) => return,
            Some(_) => {} // ignore sends before the socket is open
        }
    }
}
