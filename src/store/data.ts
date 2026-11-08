import { create } from 'zustand';
import type { ApiRequest, Collection, Folder } from '@/types/models';
import { newAuthConfig, newCollection, newFolder, newRequest } from '@/lib/factories';
import { queueDelete, queuePut } from '@/db/persistence';
import { stashInTrash } from '@/features/trash/trash';
import { now, uid } from '@/lib/utils';

/**
 * Collections / folders / requests for the ACTIVE workspace.
 * Stored as id-keyed maps so updates touch a single reference and
 * memoized selectors stay cheap even with thousands of requests.
 */
interface DataStore {
  collections: Record<string, Collection>;
  folders: Record<string, Folder>;
  requests: Record<string, ApiRequest>;

  hydrate: (data: {
    collections: Collection[];
    folders: Folder[];
    requests: ApiRequest[];
  }) => void;

  createCollection: (workspaceId: string, name: string) => Collection;
  updateCollection: (id: string, patch: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  duplicateCollection: (id: string) => Collection | null;

  createFolder: (collectionId: string, parentId: string | null, name: string) => Folder | null;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  deleteFolder: (id: string) => void;
  duplicateFolder: (id: string) => Folder | null;

  createRequest: (
    collectionId: string,
    folderId: string | null,
    partial?: Partial<ApiRequest>,
  ) => ApiRequest | null;
  upsertRequest: (request: ApiRequest) => void;
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void;
  deleteRequest: (id: string) => void;
  duplicateRequest: (id: string) => ApiRequest | null;
  moveRequest: (id: string, collectionId: string, folderId: string | null) => void;
  moveFolder: (id: string, collectionId: string, parentId: string | null) => void;
}

function collectFolderSubtree(
  folders: Record<string, Folder>,
  rootId: string,
): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(folders)) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

export const useData = create<DataStore>((set, get) => ({
  collections: {},
  folders: {},
  requests: {},

  hydrate: ({ collections, folders, requests }) =>
    set({
      // fill fields added after records were first written
      collections: Object.fromEntries(
        collections.map((c) => [
          c.id,
          {
            ...c,
            auth: c.auth ?? newAuthConfig(),
            preRequestScript: c.preRequestScript ?? '',
            testScript: c.testScript ?? '',
          },
        ]),
      ),
      folders: Object.fromEntries(folders.map((f) => [f.id, f])),
      requests: Object.fromEntries(
        requests.map((r) => [r.id, { ...r, protocol: r.protocol ?? 'http' }]),
      ),
    }),

  createCollection: (workspaceId, name) => {
    const col = newCollection({ workspaceId, name });
    set({ collections: { ...get().collections, [col.id]: col } });
    queuePut('collections', col);
    return col;
  },

  updateCollection: (id, patch) => {
    const col = get().collections[id];
    if (!col) return;
    const next = { ...col, ...patch, updatedAt: now() };
    set({ collections: { ...get().collections, [id]: next } });
    queuePut('collections', next);
  },

  deleteCollection: (id) => {
    const { collections, folders, requests } = get();
    const trashed = collections[id];
    if (trashed) {
      stashInTrash({
        workspaceId: trashed.workspaceId,
        kind: 'collection',
        name: trashed.name,
        payload: {
          collection: trashed,
          folders: Object.values(folders).filter((f) => f.collectionId === id),
          requests: Object.values(requests).filter((r) => r.collectionId === id),
        },
      });
    }
    const nextCollections = { ...collections };
    delete nextCollections[id];
    const nextFolders: Record<string, Folder> = {};
    for (const f of Object.values(folders)) {
      if (f.collectionId === id) queueDelete('folders', f.id);
      else nextFolders[f.id] = f;
    }
    const nextRequests: Record<string, ApiRequest> = {};
    for (const r of Object.values(requests)) {
      if (r.collectionId === id) queueDelete('requests', r.id);
      else nextRequests[r.id] = r;
    }
    set({ collections: nextCollections, folders: nextFolders, requests: nextRequests });
    queueDelete('collections', id);
  },

  duplicateCollection: (id) => {
    const { collections, folders, requests } = get();
    const src = collections[id];
    if (!src) return null;
    const copy = { ...src, id: uid(), name: `${src.name} Copy`, createdAt: now(), updatedAt: now() };
    const folderIdMap = new Map<string, string>();
    const newFolders: Folder[] = [];
    for (const f of Object.values(folders)) {
      if (f.collectionId !== id) continue;
      folderIdMap.set(f.id, uid());
    }
    for (const f of Object.values(folders)) {
      if (f.collectionId !== id) continue;
      newFolders.push({
        ...f,
        id: folderIdMap.get(f.id)!,
        collectionId: copy.id,
        parentId: f.parentId ? (folderIdMap.get(f.parentId) ?? null) : null,
      });
    }
    const newRequests: ApiRequest[] = Object.values(requests)
      .filter((r) => r.collectionId === id)
      .map((r) => ({
        ...structuredClone(r),
        id: uid(),
        collectionId: copy.id,
        folderId: r.folderId ? (folderIdMap.get(r.folderId) ?? null) : null,
      }));

    set({
      collections: { ...collections, [copy.id]: copy },
      folders: {
        ...get().folders,
        ...Object.fromEntries(newFolders.map((f) => [f.id, f])),
      },
      requests: {
        ...get().requests,
        ...Object.fromEntries(newRequests.map((r) => [r.id, r])),
      },
    });
    queuePut('collections', copy);
    newFolders.forEach((f) => queuePut('folders', f));
    newRequests.forEach((r) => queuePut('requests', r));
    return copy;
  },

  createFolder: (collectionId, parentId, name) => {
    const col = get().collections[collectionId];
    if (!col) return null;
    const folder = newFolder({ workspaceId: col.workspaceId, collectionId, parentId, name });
    set({ folders: { ...get().folders, [folder.id]: folder } });
    queuePut('folders', folder);
    return folder;
  },

  updateFolder: (id, patch) => {
    const folder = get().folders[id];
    if (!folder) return;
    const next = { ...folder, ...patch, updatedAt: now() };
    set({ folders: { ...get().folders, [id]: next } });
    queuePut('folders', next);
  },

  deleteFolder: (id) => {
    const { folders, requests } = get();
    const subtree = collectFolderSubtree(folders, id);
    const root = folders[id];
    if (root) {
      // root folder first so restore can re-parent from payload.folders[0]
      const subFolders = [root, ...[...subtree].filter((f) => f !== id).map((f) => folders[f]!)];
      stashInTrash({
        workspaceId: root.workspaceId,
        kind: 'folder',
        name: root.name,
        payload: {
          folders: subFolders,
          requests: Object.values(requests).filter((r) => r.folderId && subtree.has(r.folderId)),
        },
      });
    }
    const nextFolders: Record<string, Folder> = {};
    for (const f of Object.values(folders)) {
      if (subtree.has(f.id)) queueDelete('folders', f.id);
      else nextFolders[f.id] = f;
    }
    const nextRequests: Record<string, ApiRequest> = {};
    for (const r of Object.values(requests)) {
      if (r.folderId && subtree.has(r.folderId)) queueDelete('requests', r.id);
      else nextRequests[r.id] = r;
    }
    set({ folders: nextFolders, requests: nextRequests });
  },

  duplicateFolder: (id) => {
    const { folders, requests } = get();
    const src = folders[id];
    if (!src) return null;
    const subtree = collectFolderSubtree(folders, id);
    const idMap = new Map<string, string>();
    for (const fid of subtree) idMap.set(fid, uid());

    const newFolders: Folder[] = [...subtree].map((fid) => {
      const f = folders[fid]!;
      const isRoot = fid === id;
      return {
        ...f,
        id: idMap.get(fid)!,
        name: isRoot ? `${f.name} Copy` : f.name,
        parentId: isRoot ? f.parentId : f.parentId ? (idMap.get(f.parentId) ?? null) : null,
        createdAt: now(),
        updatedAt: now(),
      };
    });
    const newRequests: ApiRequest[] = Object.values(requests)
      .filter((r) => r.folderId && subtree.has(r.folderId))
      .map((r) => ({
        ...structuredClone(r),
        id: uid(),
        folderId: idMap.get(r.folderId!) ?? null,
      }));

    set({
      folders: { ...folders, ...Object.fromEntries(newFolders.map((f) => [f.id, f])) },
      requests: { ...requests, ...Object.fromEntries(newRequests.map((r) => [r.id, r])) },
    });
    newFolders.forEach((f) => queuePut('folders', f));
    newRequests.forEach((r) => queuePut('requests', r));
    return newFolders.find((f) => f.id === idMap.get(id)) ?? null;
  },

  createRequest: (collectionId, folderId, partial = {}) => {
    const col = get().collections[collectionId];
    if (!col) return null;
    // Postman-style default: requests inside a collection inherit its auth
    const req = newRequest({
      workspaceId: col.workspaceId,
      collectionId,
      folderId,
      auth: newAuthConfig({ type: 'inherit' }),
      ...partial,
    });
    set({ requests: { ...get().requests, [req.id]: req } });
    queuePut('requests', req);
    return req;
  },

  upsertRequest: (request) => {
    set({ requests: { ...get().requests, [request.id]: request } });
    queuePut('requests', request);
  },

  updateRequest: (id, patch) => {
    const req = get().requests[id];
    if (!req) return;
    const next = { ...req, ...patch, updatedAt: now() };
    set({ requests: { ...get().requests, [id]: next } });
    queuePut('requests', next);
  },

  deleteRequest: (id) => {
    const requests = { ...get().requests };
    const trashed = requests[id];
    if (trashed) {
      stashInTrash({
        workspaceId: trashed.workspaceId,
        kind: 'request',
        name: trashed.name,
        payload: { requests: [trashed] },
      });
    }
    delete requests[id];
    set({ requests });
    queueDelete('requests', id);
  },

  duplicateRequest: (id) => {
    const src = get().requests[id];
    if (!src) return null;
    const copy: ApiRequest = {
      ...structuredClone(src),
      id: uid(),
      name: `${src.name} Copy`,
      createdAt: now(),
      updatedAt: now(),
      sortOrder: src.sortOrder + 1,
    };
    set({ requests: { ...get().requests, [copy.id]: copy } });
    queuePut('requests', copy);
    return copy;
  },

  moveRequest: (id, collectionId, folderId) => {
    get().updateRequest(id, { collectionId, folderId });
  },

  moveFolder: (id, collectionId, parentId) => {
    const { folders, requests } = get();
    const src = folders[id];
    if (!src) return;
    // Prevent dropping a folder into its own subtree
    if (parentId) {
      const subtree = collectFolderSubtree(folders, id);
      if (subtree.has(parentId)) return;
    }
    const crossCollection = src.collectionId !== collectionId;
    get().updateFolder(id, { collectionId, parentId });
    if (crossCollection) {
      const subtree = collectFolderSubtree(get().folders, id);
      for (const f of Object.values(get().folders)) {
        if (subtree.has(f.id) && f.collectionId !== collectionId) {
          get().updateFolder(f.id, { collectionId });
        }
      }
      for (const r of Object.values(requests)) {
        if (r.folderId && subtree.has(r.folderId) && r.collectionId !== collectionId) {
          get().updateRequest(r.id, { collectionId });
        }
      }
    }
  },
}));
