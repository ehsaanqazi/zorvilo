import { create } from 'zustand';
import type { ApiRequest, ResponseData, SavedResponse } from '@/types/models';
import { queueDelete, queuePut } from '@/db/persistence';
import { now, uid } from '@/lib/utils';

interface SavedResponseStore {
  savedResponses: SavedResponse[];
  hydrate: (responses: SavedResponse[]) => void;
  save: (workspaceId: string, request: ApiRequest, response: ResponseData, name?: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export const useSavedResponses = create<SavedResponseStore>((set, get) => ({
  savedResponses: [],

  hydrate: (responses) => {
    // Older saves were auto-named "<request name> — <date>"; show just the request name.
    const savedResponses = responses.map((r) => {
      const prefix = `${r.requestName} — `;
      if (!r.requestName || !r.name.startsWith(prefix)) return r;
      const cleaned = { ...r, name: r.requestName };
      queuePut('responses', cleaned);
      return cleaned;
    });
    set({ savedResponses });
  },

  save: (workspaceId, request, response, name) => {
    const saved: SavedResponse = {
      id: uid(),
      workspaceId,
      requestId: request.id,
      requestName: request.name,
      name: name ?? request.name,
      method: request.method,
      url: request.url,
      response: structuredClone(response),
      createdAt: now(),
    };
    set({ savedResponses: [saved, ...get().savedResponses] });
    queuePut('responses', saved);
  },

  rename: (id, name) => {
    const savedResponses = get().savedResponses.map((r) => (r.id === id ? { ...r, name } : r));
    set({ savedResponses });
    const renamed = savedResponses.find((r) => r.id === id);
    if (renamed) queuePut('responses', renamed);
  },

  remove: (id) => {
    set({ savedResponses: get().savedResponses.filter((r) => r.id !== id) });
    queueDelete('responses', id);
  },
}));
