import { invoke } from './tauri';

/** Copy text to the system clipboard (native, works without a user-gesture/secure-context dance). */
export function copyText(text: string): Promise<void> {
  return invoke('clipboard_write', { text });
}

/** Native OK/Cancel dialog. */
export function confirmNative(title: string, message: string, okLabel?: string): Promise<boolean> {
  return invoke<boolean>('confirm_dialog', { title, message, okLabel });
}

/** Open an http(s) URL in the default browser. */
export function openExternal(url: string): Promise<void> {
  return invoke('open_external', { url });
}

export interface AppInfo {
  version: string;
  dataDir: string;
  keychainAvailable: boolean;
  platform: string;
  notes: string[];
}

export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}
