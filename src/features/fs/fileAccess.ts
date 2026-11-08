import { invoke } from '@/platform/tauri';

/** Native file dialogs (via the Rust backend). */

function extensions(accept: string): string[] {
  return accept
    .split(',')
    .map((a) => a.trim().replace(/^\./, ''))
    .filter((a) => a && !a.includes('/'));
}

/** Show the Save dialog and write text. */
export async function saveTextFile(
  content: string,
  suggestedName: string,
  _mimeType = 'application/json',
): Promise<void> {
  await invoke<boolean>('save_file', { suggestedName, text: content });
}

export async function openTextFile(accept = '.json'): Promise<{ name: string; text: string } | null> {
  const files = await invoke<{ name: string; text: string }[]>('open_text_files', {
    multiple: false,
    extensions: extensions(accept),
  });
  return files[0] ?? null;
}

/** Pick multiple text files at once (multi-import). */
export async function openTextFiles(accept = '.json'): Promise<{ name: string; text: string }[]> {
  return invoke<{ name: string; text: string }[]>('open_text_files', {
    multiple: true,
    extensions: extensions(accept),
  });
}

/** Read all .json files (recursively) from a user-picked directory; null when cancelled. */
export async function openDirectoryJsonFiles(): Promise<{ path: string; text: string }[] | null> {
  return invoke<{ path: string; text: string }[] | null>('open_directory_json');
}
