import { create } from 'zustand';
import type { Workspace } from '@/types/models';
import { newWorkspace } from '@/lib/factories';
import { queuePut } from '@/db/persistence';
import { now, uid } from '@/lib/utils';
import { deleteWorkspaceCascade, loadWorkspaceRecords } from '@/db/database';
import { loadWorkspaceData } from '@/db/bootstrap';
import { useUi } from './ui';

interface WorkspaceStore {
  workspaces: Workspace[];
  hydrate: (workspaces: Workspace[]) => void;
  create: (name: string) => Promise<Workspace>;
  rename: (id: string, name: string) => void;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
}

export const useWorkspaces = create<WorkspaceStore>((set, get) => ({
  workspaces: [],

  hydrate: (workspaces) => set({ workspaces }),

  create: async (name) => {
    const ws = newWorkspace({ name });
    set({ workspaces: [...get().workspaces, ws] });
    queuePut('workspaces', ws);
    return ws;
  },

  rename: (id, name) => {
    const workspaces = get().workspaces.map((w) =>
      w.id === id ? { ...w, name, updatedAt: now() } : w,
    );
    set({ workspaces });
    const ws = workspaces.find((w) => w.id === id);
    if (ws) queuePut('workspaces', ws);
  },

  remove: async (id) => {
    const remaining = get().workspaces.filter((w) => w.id !== id);
    if (remaining.length === 0) return; // never delete the last workspace
    set({ workspaces: remaining });
    // Cascade-delete all workspace-scoped data in one transaction
    await deleteWorkspaceCascade(id);
    const active = useUi.getState().ui.activeWorkspaceId;
    if (active === id) {
      await get().switchTo(remaining[0]!.id);
    }
  },

  duplicate: async (id) => {
    const src = get().workspaces.find((w) => w.id === id);
    if (!src) return;
    const copy = newWorkspace({ name: `${src.name} Copy`, description: src.description });
    set({ workspaces: [...get().workspaces, copy] });
    queuePut('workspaces', copy);

    const src_ = await loadWorkspaceRecords(id);
    // drafts (requests without a collection) stay with their tabs
    const requests = src_.requests.filter((r) => r.collectionId);

    const colMap = new Map(src_.collections.map((c) => [c.id, uid()]));
    const folderMap = new Map(src_.folders.map((f) => [f.id, uid()]));

    src_.collections.forEach((c) =>
      queuePut('collections', { ...c, id: colMap.get(c.id)!, workspaceId: copy.id }),
    );
    src_.folders.forEach((f) =>
      queuePut('folders', {
        ...f,
        id: folderMap.get(f.id)!,
        workspaceId: copy.id,
        collectionId: colMap.get(f.collectionId) ?? f.collectionId,
        parentId: f.parentId ? (folderMap.get(f.parentId) ?? null) : null,
      }),
    );
    requests.forEach((r) =>
      queuePut('requests', {
        ...r,
        id: uid(),
        workspaceId: copy.id,
        collectionId: colMap.get(r.collectionId) ?? r.collectionId,
        folderId: r.folderId ? (folderMap.get(r.folderId) ?? null) : null,
      }),
    );
    src_.environments.forEach((e) =>
      queuePut('environments', { ...e, id: uid(), workspaceId: copy.id, isActive: e.isActive }),
    );
  },

  switchTo: async (id) => {
    const ws = get().workspaces.find((w) => w.id === id);
    if (!ws) return;
    useUi.getState().update({ activeWorkspaceId: id, activeTabId: null });
    await loadWorkspaceData(id);
  },
}));
