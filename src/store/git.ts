import { create } from 'zustand';
import type { GitMeta } from '@/types/models';
import { newGitMeta } from '@/lib/factories';
import { flushPending, onWritesCommitted, queuePut } from '@/db/persistence';
import { invoke } from '@/platform/tauri';
import { toast, useUi } from './ui';
import { now } from '@/lib/utils';

/** Git runs in the Rust backend (libgit2); this store drives it and mirrors its state. */

export interface GitStatusSummary {
  branch: string;
  changedFiles: { path: string; status: 'added' | 'modified' | 'deleted' | 'conflicted' }[];
  ahead: boolean;
  aheadCount?: number;
  behind?: number;
  merging?: boolean;
  conflicts?: string[];
}

interface GitInfo {
  hasRepo: boolean;
  status: GitStatusSummary | null;
  branches: string[];
  remoteUrl: string | null;
}

interface ImportOutcome {
  imported: number;
  workspaceIds: string[];
  warnings: string[];
}

interface SyncOutcome {
  committed: boolean;
  pushed: boolean;
  import: ImportOutcome;
  secretWarnings: string[];
}

/** Values that older builds pre-filled; they are not the user's own settings. */
const LEGACY_DEFAULTS = {
  repoUrl: 'https://github.com/ehsaanqazi/api-collections',
  username: 'ehsaanqazi',
  authorName: ['API Client', 'Zorvilo', 'Yaak Lite'],
  authorEmail: ['api-client@localhost', 'zorvilo@localhost', 'yaak-lite@localhost'],
};

/** Drop pre-filled defaults and fill the author from the system `git config`. */
async function withSystemIdentity(meta: GitMeta): Promise<GitMeta> {
  const next = { ...meta };
  if (next.repoUrl === LEGACY_DEFAULTS.repoUrl && !next.token) next.repoUrl = '';
  if (next.username === LEGACY_DEFAULTS.username && !next.token) next.username = '';
  if (LEGACY_DEFAULTS.authorName.includes(next.authorName)) next.authorName = '';
  if (LEGACY_DEFAULTS.authorEmail.includes(next.authorEmail)) next.authorEmail = '';
  if (!next.authorName || !next.authorEmail) {
    try {
      const id = await invoke<{ name: string | null; email: string | null }>('git_system_identity');
      if (!next.authorName && id.name) next.authorName = id.name;
      if (!next.authorEmail && id.email) next.authorEmail = id.email;
    } catch {
      // no system git config — leave the fields empty
    }
  }
  return next;
}

/** Reload stores after the backend merged repository data into the database. */
async function reloadAfterImport(): Promise<void> {
  const { reloadAllData } = await import('@/db/bootstrap');
  await reloadAllData();
}

interface GitStore {
  meta: GitMeta | null;
  status: GitStatusSummary | null;
  branches: string[];
  busy: string | null;
  hasRepo: boolean;
  /** commits waiting on the remote (drives the "Sync n" badge) */
  behind: number;

  hydrate: (meta: GitMeta | null) => void;
  /** quiet fetch + behind-count; safe to poll — never toasts, never blocks */
  checkRemote: () => Promise<void>;
  updateMeta: (patch: Partial<GitMeta>) => void;
  ensureMeta: () => GitMeta;
  refreshStatus: () => Promise<void>;
  clone: () => Promise<void>;
  init: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  pullNow: () => Promise<void>;
  /** discard ALL local changes and hard-reset to the latest remote state */
  pullLatest: () => Promise<void>;
  pushNow: () => Promise<void>;
  /** throw away uncommitted changes and go back to the last commit */
  discardChanges: () => Promise<void>;
  switchBranch: (branch: string) => Promise<void>;
  /** write local state → repo, commit, pull, push (the "manual sync" button) */
  syncNow: () => Promise<void>;
  /** background sync on startup / interval: pull then refresh — never blocks UI */
  backgroundSync: () => Promise<void>;
}

export const useGit = create<GitStore>((set, get) => {
  // keep the uncommitted-changes count (Git icon badge) current as data is saved
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  onWritesCommitted(() => {
    if (!get().hasRepo) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (!get().busy) void get().refreshStatus();
    }, 1500);
  });

  async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    set({ busy: label });
    try {
      // the backend reads config + data from the database: persist pending edits first
      await flushPending();
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast('error', `Git ${label} failed`, message);
      return undefined;
    } finally {
      set({ busy: null });
    }
  }

  const applyInfo = (info: GitInfo) =>
    set({ hasRepo: info.hasRepo, status: info.status, branches: info.branches });

  const touchSync = () => {
    const meta = get().meta;
    if (meta) set({ meta: { ...meta, lastSyncAt: now() } });
  };

  return {
    meta: null,
    status: null,
    branches: [],
    busy: null,
    hasRepo: false,
    behind: 0,

    hydrate: (meta) => {
      set({ meta, status: null, branches: [], hasRepo: false, behind: 0 });
      if (meta) {
        void withSystemIdentity(meta).then((next) => {
          if (JSON.stringify(next) !== JSON.stringify(get().meta)) get().updateMeta(next);
        });
      }
      invoke<GitInfo>('git_info', { refreshTree: true })
        .then((info) => {
          applyInfo(info);
          if (info.hasRepo) void get().checkRemote();
        })
        .catch((err) => console.warn('git status failed', err));
    },

    checkRemote: async () => {
      const meta = get().meta;
      if (!meta?.repoUrl || !get().hasRepo || get().busy) return;
      try {
        const behind = await invoke<number>('git_fetch');
        set({ behind });
      } catch (err) {
        // polling must stay silent (offline, auth, etc.)
        console.warn('remote check failed', err);
      }
    },

    updateMeta: (patch) => {
      const meta = { ...get().ensureMeta(), ...patch };
      set({ meta });
      queuePut('gitMeta', meta);
    },

    ensureMeta: () => {
      const existing = get().meta;
      if (existing) return existing;
      // one shared repo for all workspaces
      const meta = newGitMeta();
      set({ meta });
      queuePut('gitMeta', meta);
      void withSystemIdentity(meta).then((next) => {
        if (next.authorName !== meta.authorName || next.authorEmail !== meta.authorEmail) {
          get().updateMeta({ authorName: next.authorName, authorEmail: next.authorEmail });
        }
      });
      return meta;
    },

    refreshStatus: async () => {
      try {
        await flushPending();
        applyInfo(await invoke<GitInfo>('git_info', { refreshTree: true }));
      } catch (err) {
        console.warn('git status failed', err);
      }
    },

    clone: async () => {
      const meta = get().ensureMeta();
      if (!meta.repoUrl) {
        toast('error', 'Enter a repository URL first');
        return;
      }
      await guard('clone', async () => {
        const result = await invoke<ImportOutcome>('git_clone');
        await reloadAfterImport();
        // land the user in a workspace that came from the repo
        const { useWorkspaces } = await import('./workspaces');
        const target = result.workspaceIds.find((id) =>
          useWorkspaces.getState().workspaces.some((w) => w.id === id),
        );
        if (target) await useWorkspaces.getState().switchTo(target);
        touchSync();
        await get().refreshStatus();
        toast('success', 'Repository cloned', `${result.imported} item(s) imported.`);
        if (useUi.getState().openDialog === 'git') useUi.getState().setDialog(null);
      });
    },

    init: async () => {
      get().ensureMeta();
      await guard('init', async () => {
        await invoke('git_init');
        await get().refreshStatus();
        toast('success', 'Repository initialized');
      });
    },

    commit: async (message) => {
      get().ensureMeta();
      await guard('commit', async () => {
        const sha = await invoke<string | null>('git_commit', { message: message || 'Update collections' });
        await get().refreshStatus();
        toast(sha ? 'success' : 'info', sha ? `Committed ${sha.slice(0, 7)}` : 'Nothing to commit');
      });
    },

    pullNow: async () => {
      get().ensureMeta();
      await guard('pull', async () => {
        const result = await invoke<ImportOutcome>('git_pull');
        await reloadAfterImport();
        touchSync();
        set({ behind: 0 });
        await get().refreshStatus();
        toast('success', 'Pulled latest changes', `${result.imported} item(s) updated.`);
      });
    },

    pullLatest: async () => {
      get().ensureMeta();
      await guard('pull', async () => {
        const result = await invoke<ImportOutcome>('git_reset_to_remote');
        await reloadAfterImport();
        touchSync();
        set({ behind: 0 });
        await get().refreshStatus();
        toast('success', 'Synced with remote', `Local state replaced — ${result.imported} item(s) loaded.`);
      });
    },

    pushNow: async () => {
      get().ensureMeta();
      await guard('push', async () => {
        await invoke('git_push');
        touchSync();
        toast('success', 'Pushed to remote');
      });
    },

    discardChanges: async () => {
      await guard('discard', async () => {
        const result = await invoke<ImportOutcome>('git_discard_changes');
        await reloadAfterImport();
        await get().refreshStatus();
        toast('success', 'Changes discarded', `Restored the last commit — ${result.imported} item(s) reverted.`);
      });
    },

    switchBranch: async (branch) => {
      get().ensureMeta();
      await guard('checkout', async () => {
        await invoke<ImportOutcome>('git_checkout', { branch });
        get().updateMeta({ branch });
        await reloadAfterImport();
        await get().refreshStatus();
        toast('success', `Switched to ${branch}`);
      });
    },

    syncNow: async () => {
      get().ensureMeta();
      await guard('sync', async () => {
        const result = await invoke<SyncOutcome>('git_sync', {
          message: `Sync ${new Date().toISOString()}`,
        });
        if (result.import.imported > 0) await reloadAfterImport();
        touchSync();
        set({ behind: 0 });
        await get().refreshStatus();
        toast('success', 'Sync complete');
        if (result.secretWarnings.length > 0) {
          toast(
            'error',
            'Possible credentials were committed',
            `${result.secretWarnings.slice(0, 3).join('\n')}\nUse secret variables for tokens and passwords.`,
          );
        }
      });
    },

    backgroundSync: async () => {
      const meta = get().meta;
      if (!meta?.repoUrl || !get().hasRepo || get().busy) return;
      try {
        await flushPending();
        const result = await invoke<ImportOutcome>('git_pull');
        if (result.imported > 0) await reloadAfterImport();
        touchSync();
        set({ behind: 0 });
        applyInfo(await invoke<GitInfo>('git_info'));
      } catch (err) {
        // Background sync must never interrupt the user
        console.warn('background sync failed', err);
      }
    },
  };
});
