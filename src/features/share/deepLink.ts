import type { ApiRequest } from '@/types/models';
import { getRecord } from '@/db/database';
import { invoke, listen } from '@/platform/tauri';
import { useUi, toast } from '@/store/ui';
import { useData } from '@/store/data';
import { useTabs } from '@/store/tabs';
import { useWorkspaces } from '@/store/workspaces';

/**
 * Deep-linking / "share this request".
 *
 * Each saved request has a stable id and lives inside a workspace. A share
 * link encodes both: `zorvilo://request/<workspaceId>/<requestId>`. The OS
 * hands these links to Zorvilo (registered URL scheme); anyone working off the
 * same Git repo has that request locally, so opening the link resolves it. If
 * it can't be found (not on this repo, not pulled yet, or deleted) we say so.
 */

const SCHEME_PREFIX = 'zorvilo://request/';

/** Build the shareable link that opens `requestId` in `workspaceId`. */
export function buildShareUrl(workspaceId: string, requestId: string): string {
  return `${SCHEME_PREFIX}${encodeURIComponent(workspaceId)}/${encodeURIComponent(requestId)}`;
}

/** Parse a share link into its ids, or null if it isn't one. */
export function parseShareLink(link: string): { workspaceId: string; requestId: string } | null {
  const trimmed = link.trim();
  if (!trimmed.toLowerCase().startsWith(SCHEME_PREFIX)) return null;
  const rest = trimmed.slice(SCHEME_PREFIX.length).replace(/\/+$/, '');
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  try {
    const workspaceId = decodeURIComponent(rest.slice(0, slash));
    const requestId = decodeURIComponent(rest.slice(slash + 1));
    if (!workspaceId || !requestId) return null;
    return { workspaceId, requestId };
  } catch {
    return null;
  }
}

/** Resolve a share link and open its request in a tab. */
export async function openSharedRequest(link: string): Promise<void> {
  const parsed = parseShareLink(link);
  if (!parsed) return;
  const { workspaceId, requestId } = parsed;

  // The request may live in a workspace other than the active one, and only
  // the active workspace is hydrated in memory — so look it up in the database.
  const request = await getRecord<ApiRequest>('requests', requestId);
  if (!request) {
    toast(
      'error',
      'Request not found',
      'This shared request isn’t in your repo — pull the latest changes or ask for access.',
    );
    return;
  }

  // Prefer the request's own workspace; fall back to the one in the link.
  const targetWorkspaceId = request.workspaceId || workspaceId;
  const active = useUi.getState().ui.activeWorkspaceId;
  if (targetWorkspaceId && targetWorkspaceId !== active) {
    const exists = useWorkspaces.getState().workspaces.some((w) => w.id === targetWorkspaceId);
    if (exists) await useWorkspaces.getState().switchTo(targetWorkspaceId);
  }

  if (!useData.getState().requests[requestId]) {
    toast('error', 'Request not found', 'This shared request couldn’t be opened in your current workspaces.');
    return;
  }
  useTabs.getState().openRequest(requestId);
}

/**
 * Handle links that launched the app and links opened while it runs.
 * Returns a disposer for the live listener.
 */
export async function initShareLinks(): Promise<() => void> {
  const unlisten = await listen<string>('deep-link', (url) => void openSharedRequest(url));
  const pending = await invoke<string[]>('take_pending_links').catch(() => [] as string[]);
  for (const url of pending) await openSharedRequest(url);
  return unlisten;
}
