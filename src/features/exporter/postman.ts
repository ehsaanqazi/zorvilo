import type { ApiRequest, Collection, Environment, Folder, HistoryEntry, SavedResponse } from '@/types/models';
import { flushPending } from '@/db/persistence';
import { invoke } from '@/platform/tauri';
import { slugify } from '@/lib/utils';

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

/** Export one environment into a dated `zorvilo_export_dd-mm-yy/environments/` folder. */
export async function saveEnvironmentToFile(environment: Environment): Promise<boolean> {
  await flushPending();
  const data = await exportPostmanEnvironment(environment);
  return saveExportFolder({
    collections: [],
    environments: [{ name: `${slugify(environment.name)}.postman_environment.json`, data }],
  });
}

/** `zorvilo_export_dd-mm-yy` for today. */
export function exportFolderName(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `zorvilo_export_${dd}-${mm}-${yy}`;
}

/** Make file names unique within one folder (`a.json`, `a-2.json`, …). */
function uniqueNames(files: { name: string; data: unknown }[]) {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const count = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, count);
    if (count === 1) return f;
    const dot = f.name.indexOf('.');
    const name = dot > 0 ? `${f.name.slice(0, dot)}-${count}${f.name.slice(dot)}` : `${f.name}-${count}`;
    return { ...f, name };
  });
}

/**
 * Pick a location and write a `zorvilo_export_dd-mm-yy` folder into it, with a
 * `collections/` and/or `environments/` sub-folder (only for kinds that have files).
 */
export async function saveExportFolder(groups: {
  collections: { name: string; data: unknown }[];
  environments: { name: string; data: unknown }[];
}): Promise<boolean> {
  const files = [
    ...uniqueNames(groups.collections).map((f) => ({ ...f, name: `collections/${f.name}` })),
    ...uniqueNames(groups.environments).map((f) => ({ ...f, name: `environments/${f.name}` })),
  ];
  if (files.length === 0) return false;
  const dir = await invoke<string | null>('save_files_to_folder', {
    folder: exportFolderName(),
    files: files.map((f) => ({ name: f.name, text: JSON.stringify(f.data, null, 2) })),
  });
  return dir !== null;
}

/** Full-workspace bundle in our own format (round-trips via import). */
export async function exportWorkspaceBundle(workspaceId: string): Promise<any> {
  await flushPending();
  return invoke('export_workspace_bundle', { workspaceId, includeSecrets: true });
}

export function exportHistory(entries: HistoryEntry[]): any {
  return { __zorvilo: 'history', version: 1, entries };
}

export function exportSavedResponses(responses: SavedResponse[]): any {
  return { __zorvilo: 'saved-responses', version: 1, responses };
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
