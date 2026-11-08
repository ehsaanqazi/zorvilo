/**
 * Bridge to the Rust backend. The window is created with `withGlobalTauri`,
 * so the IPC API lives on `window.__TAURI__` and no extra npm package is needed.
 * Every privileged operation (network, storage, Git, files) goes through a
 * Rust command; the UI never touches them directly.
 */

type UnlistenFn = () => void;

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<UnlistenFn>;
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

function tauri(): TauriGlobal {
  const t = window.__TAURI__;
  if (!t) {
    throw new Error('Zorvilo must run inside its desktop app (Tauri runtime not found).');
  }
  return t;
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

/** Call a Rust command. Rejections carry the backend's human-readable message as an Error. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauri().core.invoke<T>(cmd, args);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Subscribe to a backend event; returns the unsubscribe function. */
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return tauri().event.listen<T>(event, (e) => handler(e.payload));
}
