import { createZip, type ZipEntry } from '@/lib/zip';
import { base64ToBytes, downloadBlob } from '@/lib/utils';
import { flushPending } from '@/db/persistence';
import { invoke } from '@/platform/tauri';

/**
 * Save the whole repo as a ZIP. The working tree is refreshed from the
 * database first, so the backup always matches the current data — including
 * git history (.git) when a repository exists.
 */
export async function downloadRepoBackup(): Promise<number> {
  await flushPending();
  const files = await invoke<{ path: string; base64: string }[]>('git_backup_files');
  const entries: ZipEntry[] = files.map((f) => ({ path: f.path, data: base64ToBytes(f.base64) }));
  const stamp = new Date().toISOString().slice(0, 10);
  await downloadBlob(createZip(entries), `zorvilo-backup-${stamp}.zip`);
  return entries.length;
}
