import { create } from 'zustand';
import { invoke, listen } from '@/platform/tauri';
import { uid } from '@/lib/utils';

/**
 * WebSocket / Socket.IO sessions. The sockets live in the Rust backend; this
 * store mirrors their status and message log per tab from `realtime` events.
 */

export type RealtimeKind = 'ws' | 'socketio';
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export interface RtMessage {
  id: string;
  dir: 'in' | 'out' | 'sys';
  text: string;
  event?: string;
  ts: number;
}

interface TabConnection {
  status: RealtimeStatus;
  messages: RtMessage[];
}

type RealtimeEvent =
  | { type: 'status'; connId: string; generation: number; status: RealtimeStatus; detail: string | null }
  | {
      type: 'message';
      connId: string;
      generation: number;
      dir: 'in' | 'out' | 'sys';
      text: string;
      event: string | null;
      binary: boolean;
      ts: number;
    };

const MAX_MESSAGES = 500;
/**
 * Current connection generation per tab; events from older generations are
 * dropped. -1 = connect requested, generation not known yet (accept events).
 */
const generations = new Map<string, number>();

interface RealtimeStore {
  connections: Record<string, TabConnection | undefined>;
  connect: (tabId: string, kind: RealtimeKind, url: string, headers?: [string, string][]) => void;
  disconnect: (tabId: string) => void;
  send: (tabId: string, text: string, event?: string) => void;
  clearMessages: (tabId: string) => void;
}

export const useRealtime = create<RealtimeStore>((set, get) => {
  const push = (tabId: string, message: Omit<RtMessage, 'id'>) => {
    const conn = get().connections[tabId] ?? { status: 'disconnected' as const, messages: [] };
    const messages = [...conn.messages, { ...message, id: uid() }].slice(-MAX_MESSAGES);
    set({ connections: { ...get().connections, [tabId]: { ...conn, messages } } });
  };

  const setStatus = (tabId: string, status: RealtimeStatus) => {
    const conn = get().connections[tabId] ?? { status, messages: [] };
    set({ connections: { ...get().connections, [tabId]: { ...conn, status } } });
  };

  // one global subscription for every connection
  void listen<RealtimeEvent>('realtime', (ev) => {
    const current = generations.get(ev.connId);
    if (current !== undefined && current >= 0 && ev.generation < current) return; // stale socket
    if (ev.type === 'status') {
      setStatus(ev.connId, ev.status);
      if (ev.detail) push(ev.connId, { dir: 'sys', text: ev.detail, ts: Date.now() });
      const gen = generations.get(ev.connId);
      if (ev.status === 'disconnected' && (gen === -1 || gen === ev.generation)) {
        generations.delete(ev.connId);
      }
    } else {
      push(ev.connId, { dir: ev.dir, text: ev.text, event: ev.event ?? undefined, ts: ev.ts });
    }
  }).catch((err) => console.error('realtime listener failed', err));

  return {
    connections: {},

    connect: (tabId, kind, url, headers = []) => {
      if (generations.has(tabId)) return; // already connected/connecting
      generations.set(tabId, -1); // reserve until the backend answers
      setStatus(tabId, 'connecting');
      invoke<number>('realtime_connect', { connId: tabId, kind, url, headers })
        .then((generation) => {
          // the socket may already have closed (bad URL) before we learned its generation
          if (generations.get(tabId) === -1) {
            if (get().connections[tabId]?.status === 'disconnected') generations.delete(tabId);
            else generations.set(tabId, generation);
          }
        })
        .catch((err) => {
          generations.delete(tabId);
          setStatus(tabId, 'disconnected');
          push(tabId, { dir: 'sys', text: err instanceof Error ? err.message : String(err), ts: Date.now() });
        });
    },

    disconnect: (tabId) => {
      void invoke('realtime_disconnect', { connId: tabId });
    },

    send: (tabId, text, event) => {
      // the backend echoes successfully sent frames as 'out' messages
      invoke<boolean>('realtime_send', { connId: tabId, text, event })
        .then((ok) => {
          if (!ok) push(tabId, { dir: 'sys', text: 'Not connected — message not sent.', ts: Date.now() });
        })
        .catch(() => push(tabId, { dir: 'sys', text: 'Not connected — message not sent.', ts: Date.now() }));
    },

    clearMessages: (tabId) => {
      const conn = get().connections[tabId];
      if (!conn) return;
      set({ connections: { ...get().connections, [tabId]: { ...conn, messages: [] } } });
    },
  };
});
