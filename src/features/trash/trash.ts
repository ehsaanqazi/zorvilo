import type { TrashEntry } from '@/types/models';
import { loadWorkspaceData } from '@/db/bootstrap';
import { flushPending, queueDelete, queuePut } from '@/db/persistence';
import { invoke } from '@/platform/tauri';
import { now, uid } from '@/lib/utils';
import { toast, useUi } from '@/store/ui';

/** Capture a deleted entity so it can be restored for 30 days. */
export function stashInTrash(entry: Omit<TrashEntry, 'id' | 'deletedAt'>): void {
  queuePut('trash', { ...entry, id: uid(), deletedAt: now() });
}

export async function listTrash(workspaceId: string): Promise<TrashEntry[]> {
  await flushPending();
  const entries = await invoke<TrashEntry[]>('trash_list', { workspaceId });
  return entries.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Expired entries are purged by the backend at startup; kept for API compatibility. */
export async function purgeExpiredTrash(): Promise<void> {}

export async function deleteTrashEntry(id: string): Promise<void> {
  queueDelete('trash', id);
  await flushPending();
}

export async function emptyTrash(workspaceId: string): Promise<void> {
  await flushPending();
  await invoke('trash_empty', { workspaceId });
}

/** Put the payload back into the live tables (validated in Rust) and refresh the stores. */
export async function restoreTrashEntry(entry: TrashEntry): Promise<boolean> {
  try {
    await flushPending();
    const activeWorkspaceId = useUi.getState().ui.activeWorkspaceId;
    await invoke<string>('trash_restore', { id: entry.id, activeWorkspaceId });
    await loadWorkspaceData(activeWorkspaceId);
    toast('success', `Restored ${entry.kind}`, entry.name);
    return true;
  } catch (err) {
    toast('error', 'Cannot restore', err instanceof Error ? err.message : String(err));
    return false;
  }
}
