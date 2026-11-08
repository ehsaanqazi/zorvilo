import type { ApiRequest, Collection, Environment, Folder, HistoryEntry, SavedResponse } from '@/types/models';
import { flushPending } from '@/db/persistence';
import { invoke } from '@/platform/tauri';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postman Collection v2.1 export (built by the Rust backend). Secret values are included, as before. */
export function exportPostmanCollection(
  collection: Collection,
  folders: Folder[],
  requests: ApiRequest[],
): Promise<any> {
  return invoke('export_postman_collection', {
    args: { collection, folders, requests, includeSecrets: true },
  });
}

export function exportPostmanEnvironment(environment: Environment): Promise<any> {
  return invoke('export_postman_environment', { environment, includeSecrets: true });
}

/** Full-workspace bundle in our own format (round-trips via import). */
export async function exportWorkspaceBundle(workspaceId: string): Promise<any> {
  await flushPending();
  return invoke('export_workspace_bundle', { workspaceId, includeSecrets: true });
}

export function exportHistory(entries: HistoryEntry[]): any {
  return { __yaakLite: 'history', version: 1, entries };
}

export function exportSavedResponses(responses: SavedResponse[]): any {
  return { __yaakLite: 'saved-responses', version: 1, responses };
}

/** Save several JSON documents: one file → Save dialog; several → pick a folder. */
export async function saveJsonFiles(files: { name: string; data: unknown }[]): Promise<boolean> {
  if (files.length === 0) return false;
  if (files.length === 1) {
    return invoke<boolean>('save_file', {
      suggestedName: files[0]!.name,
      text: JSON.stringify(files[0]!.data, null, 2),
    });
  }
  const dir = await invoke<string | null>('save_files_to_folder', {
    files: files.map((f) => ({ name: f.name, text: JSON.stringify(f.data, null, 2) })),
  });
  return dir !== null;
}
