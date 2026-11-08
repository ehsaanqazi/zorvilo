import { invoke } from '@/platform/tauri';
import type { TableName } from './database';

/**
 * Write queue. Store mutations are applied in memory immediately and queued
 * here; the queue is debounced, coalesced per record and sent to Rust as one
 * transactional batch, so typing never waits on disk I/O.
 */

type WritableTable = TableName | 'gitMeta';

type DbWrite =
  | { op: 'put'; table: WritableTable; value: unknown }
  | { op: 'delete'; table: WritableTable; id: string }
  | { op: 'setting'; key: string; value: unknown };

const WRITE_DELAY_MS = 300;

/** insertion-ordered: later writes to the same record replace earlier ones */
const pending = new Map<string, DbWrite>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> = Promise.resolve();
let onError: ((err: unknown) => void) | null = null;

export function setPersistenceErrorHandler(handler: (err: unknown) => void) {
  onError = handler;
}

const flushListeners = new Set<() => void>();

/** Be notified after a batch of writes has been committed. Returns an unsubscribe function. */
export function onWritesCommitted(listener: () => void): () => void {
  flushListeners.add(listener);
  return () => flushListeners.delete(listener);
}

function schedule() {
  if (timer === undefined) {
    timer = setTimeout(() => void flushNow(), WRITE_DELAY_MS);
  }
}

function flushNow(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (pending.size === 0) return inFlight;
  const writes = [...pending.values()];
  pending.clear();
  // batches are applied strictly in order
  inFlight = inFlight.then(async () => {
    try {
      const warnings = await invoke<string[]>('db_apply', { writes });
      for (const w of warnings) console.warn('write skipped:', w);
      flushListeners.forEach((l) => l());
    } catch (err) {
      console.error('database write failed', err);
      onError?.(err);
    }
  });
  return inFlight;
}

/** Queue an upsert. */
export function queuePut<T extends { id: string }>(table: WritableTable, entity: T): void {
  const key = `${table}:${entity.id}`;
  pending.delete(key); // keep order: re-insert at the end
  pending.set(key, { op: 'put', table, value: entity });
  schedule();
}

export function queueDelete(table: WritableTable, id: string): void {
  const key = `${table}:${id}`;
  pending.delete(key);
  pending.set(key, { op: 'delete', table, id });
  schedule();
}

export function queueSetting(key: string, value: unknown): void {
  const k = `setting:${key}`;
  pending.delete(k);
  pending.set(k, { op: 'setting', key, value });
  schedule();
}

/** Flush immediately (fire-and-forget); used when the window hides/closes. */
export function flushAll(): void {
  void flushNow();
}

/** Awaitable flush — call before reading back from the database or before Git operations. */
export function flushPending(): Promise<void> {
  return flushNow();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}
