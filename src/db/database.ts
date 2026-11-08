import type {
  ApiRequest,
  Collection,
  Environment,
  Folder,
  HistoryEntry,
  SavedResponse,
  ScopedVariable,
  TabState,
  Workspace,
} from '@/types/models';
import { invoke } from '@/platform/tauri';
import { flushPending } from './persistence';

/**
 * Local data lives in SQLite, owned by the Rust backend (secret variable
 * values and the Git token are kept in the OS keychain). This module is the
 * UI's read API; writes go through `persistence.ts`.
 */

export type TableName =
  | 'workspaces'
  | 'collections'
  | 'folders'
  | 'requests'
  | 'responses'
  | 'history'
  | 'tabs'
  | 'environments'
  | 'variables'
  | 'trash';

export interface WorkspacePayload {
  collections: Collection[];
  folders: Folder[];
  requests: ApiRequest[];
  environments: Environment[];
  globals: ScopedVariable[];
  tabs: TabState[];
  history: HistoryEntry[];
  responses: SavedResponse[];
  warnings: string[];
}

/** Everything that belongs to one workspace (pending writes are flushed first). */
export async function loadWorkspaceRecords(workspaceId: string): Promise<WorkspacePayload> {
  await flushPending();
  return invoke<WorkspacePayload>('db_load_workspace', { workspaceId });
}

/** Fetch a single record by id, or null. */
export async function getRecord<T>(table: TableName, id: string): Promise<T | null> {
  await flushPending();
  return invoke<T | null>('db_get', { table, id });
}

export async function deleteWorkspaceCascade(workspaceId: string): Promise<void> {
  await flushPending();
  await invoke('db_delete_workspace', { workspaceId });
}

export async function clearHistoryRecords(workspaceId: string): Promise<void> {
  await flushPending();
  await invoke('db_clear_history', { workspaceId });
}

export type { Workspace };

/**
 * Last-resort recovery for an unreadable database (boot error screen): the
 * old file is moved aside, a fresh database is created and the UI reloads.
 */
export async function resetDatabase(): Promise<void> {
  await invoke('db_reset');
  window.location.reload();
}

/**
 * Delete EVERYTHING: all records, keychain secrets, the Git working tree and
 * this window's local storage. Reloads to a fresh state.
 */
export async function wipeAllData(): Promise<void> {
  await flushPending().catch(() => undefined);
  await invoke('db_wipe_all');
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // storage may be unavailable
  }
  window.location.reload();
}
