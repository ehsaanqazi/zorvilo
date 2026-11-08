import { create } from 'zustand';
import type { ApiRequest, HistoryEntry, ResponseData } from '@/types/models';
import { queueDelete, queuePut } from '@/db/persistence';
import { now, uid } from '@/lib/utils';
import { useSettings } from './settings';
import { clearHistoryRecords } from '@/db/database';

interface HistoryStore {
  entries: HistoryEntry[];
  hydrate: (entries: HistoryEntry[]) => void;
  record: (workspaceId: string, request: ApiRequest, response: ResponseData) => void;
  remove: (id: string) => void;
  toggleFavorite: (id: string) => void;
  clear: (workspaceId: string) => void;
}

export const useHistory = create<HistoryStore>((set, get) => ({
  entries: [],

  hydrate: (entries) => set({ entries }),

  record: (workspaceId, request, response) => {
    const entry: HistoryEntry = {
      id: uid(),
      workspaceId,
      requestId: request.collectionId ? request.id : null,
      method: request.method,
      url: request.url,
      status: response.status,
      statusText: response.statusText,
      durationMs: response.durationMs,
      sizeBytes: response.sizeBytes,
      timestamp: now(),
      favorite: false,
      snapshot: structuredClone(request),
    };
    const max = useSettings.getState().settings.maxHistoryEntries;
    const entries = [entry, ...get().entries];
    const overflow = entries.slice(max).filter((e) => !e.favorite);
    const kept = entries.filter((e) => !overflow.includes(e));
    set({ entries: kept });
    queuePut('history', entry);
    overflow.forEach((e) => queueDelete('history', e.id));
  },

  remove: (id) => {
    set({ entries: get().entries.filter((e) => e.id !== id) });
    queueDelete('history', id);
  },

  toggleFavorite: (id) => {
    const entries = get().entries.map((e) =>
      e.id === id ? { ...e, favorite: !e.favorite } : e,
    );
    set({ entries });
    const entry = entries.find((e) => e.id === id);
    if (entry) queuePut('history', entry);
  },

  clear: (workspaceId) => {
    const kept = get().entries.filter((e) => e.workspaceId !== workspaceId || e.favorite);
    set({ entries: kept });
    void clearHistoryRecords(workspaceId);
  },
}));
