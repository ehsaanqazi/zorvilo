import { loadWorkspaceRecords } from './database';
import { queuePut, setPersistenceErrorHandler } from './persistence';
import type { AppSettings, GitMeta, UiState, Workspace } from '@/types/models';
import { defaultSettings, defaultUiState, newWorkspace } from '@/lib/factories';
import { invoke } from '@/platform/tauri';
import { useSettings } from '@/store/settings';
import { useUi, toast } from '@/store/ui';
import { useData } from '@/store/data';
import { useWorkspaces } from '@/store/workspaces';
import { useEnvironments } from '@/store/environments';
import { useTabs } from '@/store/tabs';
import { useHistory } from '@/store/history';
import { useSavedResponses } from '@/store/responses';
import { useGit } from '@/store/git';

interface BootstrapData {
  settings: Partial<AppSettings> | null;
  ui: Partial<UiState> | null;
  workspaces: Workspace[];
  gitMeta: GitMeta | null;
  warnings: string[];
}

/** Load every workspace-scoped table into the stores. */
export async function loadWorkspaceData(workspaceId: string): Promise<void> {
  const data = await loadWorkspaceRecords(workspaceId);

  useData.getState().hydrate({
    collections: data.collections,
    folders: data.folders,
    requests: data.requests,
  });
  useEnvironments.getState().hydrate(data.environments, data.globals);
  useTabs.getState().hydrate(data.tabs);
  useHistory.getState().hydrate([...data.history].sort((a, b) => b.timestamp - a.timestamp));
  useSavedResponses.getState().hydrate([...data.responses].sort((a, b) => b.createdAt - a.createdAt));
  if (data.warnings.length > 0) {
    toast('error', 'Some records could not be read', data.warnings.slice(0, 3).join('\n'));
  }

  // Make sure the persisted active tab still exists
  const ui = useUi.getState().ui;
  if (ui.activeTabId && !data.tabs.some((t) => t.id === ui.activeTabId)) {
    const first = [...data.tabs].sort((a, b) => a.sortOrder - b.sortOrder)[0];
    useUi.getState().update({ activeTabId: first?.id ?? null });
  }
}

/** Reload workspaces + the active workspace after the backend changed data (Git, trash, imports). */
export async function reloadAllData(): Promise<void> {
  const data = await invoke<BootstrapData>('db_bootstrap');
  useWorkspaces.getState().hydrate(data.workspaces);
  const ui = useUi.getState().ui;
  if (!data.workspaces.some((w) => w.id === ui.activeWorkspaceId) && data.workspaces[0]) {
    useUi.getState().update({ activeWorkspaceId: data.workspaces[0].id, activeTabId: null });
  }
  await loadWorkspaceData(useUi.getState().ui.activeWorkspaceId);
}

/**
 * Boot: read settings, workspaces and the active workspace from the local
 * database. First run creates an empty default workspace.
 */
export async function bootstrap(): Promise<void> {
  setPersistenceErrorHandler((err) =>
    toast(
      'error',
      'Failed to save changes',
      err instanceof Error ? err.message : 'The local database rejected the write.',
    ),
  );

  try {
    const data = await invoke<BootstrapData>('db_bootstrap');

    const settings: AppSettings = { ...defaultSettings(), ...(data.settings ?? {}) };
    useSettings.getState().hydrate(settings);

    let workspaces = data.workspaces;
    if (workspaces.length === 0) {
      const ws = newWorkspace({ name: 'My Workspace' });
      queuePut('workspaces', ws);
      workspaces = [ws];
    }
    useWorkspaces.getState().hydrate(workspaces);

    const ui: UiState = { ...defaultUiState(), ...(data.ui ?? {}) };
    if (!workspaces.some((w) => w.id === ui.activeWorkspaceId)) {
      ui.activeWorkspaceId = workspaces[0]!.id;
    }
    useUi.getState().hydrate(ui);

    await loadWorkspaceData(ui.activeWorkspaceId);
    useGit.getState().hydrate(data.gitMeta);
    if (data.warnings.length > 0) {
      toast('error', 'Some workspaces could not be read', data.warnings.slice(0, 3).join('\n'));
    }

    useUi.getState().setReady(true);
  } catch (err) {
    console.error('bootstrap failed', err);
    useUi
      .getState()
      .setBootError(err instanceof Error ? err.message : 'Failed to open the local database.');
  }
}
