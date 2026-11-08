//! WebSocket and Socket.IO connections. Events are pushed to the UI as
//! `realtime` events tagged with the connection id and generation.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use zorvilo_realtime::socketio::SocketIoOptions;
use zorvilo_realtime::websocket::WsOptions;
use zorvilo_realtime::{Command, ConnStatus, Direction, RealtimeEvent, RealtimeEventKind};

use super::CmdResult;
use crate::state::{lock, AppState, LiveConnection};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
enum RealtimePayload {
    #[serde(rename_all = "camelCase")]
    Status { conn_id: String, generation: u64, status: &'static str, detail: Option<String> },
    #[serde(rename_all = "camelCase")]
    Message { conn_id: String, generation: u64, dir: &'static str, text: String, event: Option<String>, binary: bool, ts: i64 },
}

fn to_payload(ev: RealtimeEvent) -> RealtimePayload {
    match ev.kind {
        RealtimeEventKind::Status(s, detail) => RealtimePayload::Status {
            conn_id: ev.conn_id,
            generation: ev.generation,
            status: match s {
                ConnStatus::Connecting | ConnStatus::Reconnecting => "connecting",
                ConnStatus::Connected => "connected",
                ConnStatus::Disconnected => "disconnected",
            },
            detail,
        },
        RealtimeEventKind::Message(m) => RealtimePayload::Message {
            conn_id: ev.conn_id,
            generation: ev.generation,
            dir: match m.direction {
                Direction::In => "in",
                Direction::Out => "out",
                Direction::System => "sys",
            },
            text: m.text,
            event: m.event,
            binary: m.binary,
            ts: m.timestamp_ms,
        },
    }
}

/// Open a connection for `conn_id` (replacing any previous one). Returns its generation.
#[tauri::command]
pub async fn realtime_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    conn_id: String,
    kind: String,
    url: String,
    headers: Option<Vec<(String, String)>>,
) -> CmdResult<u64> {
    if url.trim().is_empty() {
        return Err("Enter a URL first".into());
    }
    if let Some(old) = lock(&state.realtime).remove(&conn_id) {
        old.handle.close();
    }
    let generation = state.next_generation();
    let emitter = app.clone();
    let sink: zorvilo_realtime::EventSink = Arc::new(move |ev: RealtimeEvent| {
        let disconnected = matches!(ev.kind, RealtimeEventKind::Status(ConnStatus::Disconnected, _));
        let (id, gen) = (ev.conn_id.clone(), ev.generation);
        let _ = emitter.emit("realtime", to_payload(ev));
        if disconnected {
            use tauri::Manager;
            let st = emitter.state::<AppState>();
            let mut map = lock(&st.realtime);
            if map.get(&id).map(|c| c.generation == gen).unwrap_or(false) {
                map.remove(&id);
            }
        }
    });
    let headers = headers.unwrap_or_default();
    let rt = tokio::runtime::Handle::current();
    let socket_io = kind == "socketio";
    let handle = if socket_io {
        let opts = SocketIoOptions { url: url.trim().to_string(), headers, ..Default::default() };
        zorvilo_realtime::socketio::connect(&rt, conn_id.clone(), generation, opts, sink)
    } else {
        let opts = WsOptions { url: zorvilo_realtime::to_ws_url(&url), headers };
        zorvilo_realtime::websocket::connect(&rt, conn_id.clone(), generation, opts, sink)
    };
    lock(&state.realtime).insert(conn_id, LiveConnection { generation, socket_io, handle });
    Ok(generation)
}

/// Send a text frame (WebSocket) or emit an event (Socket.IO). False when not connected.
#[tauri::command]
pub fn realtime_send(state: State<'_, AppState>, conn_id: String, text: String, event: Option<String>) -> bool {
    let map = lock(&state.realtime);
    let Some(conn) = map.get(&conn_id) else { return false };
    let cmd = if conn.socket_io {
        Command::Emit { event: event.filter(|e| !e.trim().is_empty()).unwrap_or_else(|| "message".into()), payload: text }
    } else {
        Command::Text(text)
    };
    conn.handle.send(cmd)
}

#[tauri::command]
pub fn realtime_disconnect(state: State<'_, AppState>, conn_id: String) {
    if let Some(conn) = lock(&state.realtime).remove(&conn_id) {
        conn.handle.close();
    }
}
