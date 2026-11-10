import { invoke } from '@/platform/tauri';
import { UPDATE_REPO } from './appMeta';

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseName: string;
  notes: string;
  releaseUrl: string;
  asset: { name: string; url: string; size: number } | null;
}

/** Ask the backend whether GitHub Releases has a newer version. */
export function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>('update_check', { repo: UPDATE_REPO });
}

export interface InstallOutcome {
  /** The update is being applied over the current app, which is about to restart. */
  restarting: boolean;
  /** Where the installer was saved when it had to be opened manually. */
  path: string | null;
}

/** Download the release asset and install it over the current app (restarting it). */
export function installUpdate(asset: NonNullable<UpdateInfo['asset']>): Promise<InstallOutcome> {
  return invoke<InstallOutcome>('update_install', { url: asset.url, name: asset.name });
}

/** Toast describing what happens after `installUpdate` resolves. */
export function installedMessage(version: string, outcome: InstallOutcome): [string, string] {
  return outcome.restarting
    ? [`Updating to Zorvilo ${version}`, 'Zorvilo will restart in a moment with the new version.']
    : [
        `Zorvilo ${version} downloaded`,
        `The installer was opened (${outcome.path ?? 'Downloads'}). Quit Zorvilo and complete the installation to finish updating.`,
      ];
}

const SKIPPED_KEY = 'zorvilo.update.skippedVersion';
const REMIND_KEY = 'zorvilo.update.remindAfter';
const REMIND_DELAY_MS = 24 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the prompt simply shows again next launch.
  }
}

/** Never prompt again for this exact version (a newer one will still prompt). */
export function skipVersion(version: string): void {
  write(SKIPPED_KEY, version);
}

/** Don't prompt again until a day has passed. */
export function remindLater(): void {
  write(REMIND_KEY, String(Date.now() + REMIND_DELAY_MS));
}

/** Clear snooze state, e.g. once the user starts an update. */
export function clearUpdatePrompts(): void {
  write(REMIND_KEY, null);
}

/** Whether the startup prompt should be shown for `info`. */
export function shouldPrompt(info: UpdateInfo): boolean {
  if (!info.updateAvailable) return false;
  if (read(SKIPPED_KEY) === info.latest) return false;
  const remindAfter = Number(read(REMIND_KEY) ?? 0);
  return !(remindAfter && Date.now() < remindAfter);
}
