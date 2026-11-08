import { create } from 'zustand';
import type { ApiRequest, ResponseData, TabState } from '@/types/models';
import type { TestResult } from '@/types/models';
import { newRequest, newTab } from '@/lib/factories';
import { queueDelete, queuePut } from '@/db/persistence';
import { now } from '@/lib/utils';
import { useUi } from './ui';
import { useData } from './data';
import { useSettings } from './settings';

export interface TabTestResults {
  tests: TestResult[];
  logs: string[];
  error: string | null;
}

/** A draft tab that carries real, unsaved edits (an untouched blank draft doesn't count). */
function isUnsavedDraft(tab: TabState): boolean {
  const draft = tab.draft;
  if (!draft) return false;
  const isEmptyDraft =
    !draft.url.trim() && !draft.body.content.trim() && draft.name === 'Untitled Request';
  return !isEmptyDraft;
}

interface TabStore {
  tabs: TabState[];
  /** transient: last response per tab (not persisted) */
  responses: Record<string, ResponseData | undefined>;
  sending: Record<string, boolean>;
  testResults: Record<string, TabTestResults | undefined>;

  hydrate: (tabs: TabState[]) => void;

  openRequest: (requestId: string) => void;
  openCollection: (collectionId: string) => void;
  openDraft: (partial?: Partial<ApiRequest>) => TabState;
  close: (tabId: string) => void;
  /** close with the "save unsaved draft?" flow (prompt / auto-save / discard) */
  requestClose: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeAll: () => void;
  /** close every tab matching the predicate, honoring the unsaved-draft flow */
  closeMany: (shouldClose: (tab: TabState) => boolean) => void;
  activate: (tabId: string | null) => void;
  togglePin: (tabId: string) => void;
  duplicate: (tabId: string) => void;
  reorder: (tabId: string, beforeTabId: string | null) => void;
  updateDraft: (tabId: string, patch: Partial<ApiRequest>) => void;
  /** convert a draft tab into a persisted request inside a collection */
  saveDraftTo: (tabId: string, collectionId: string, folderId: string | null) => void;
  setResponse: (tabId: string, response: ResponseData | undefined) => void;
  setSending: (tabId: string, sending: boolean) => void;
  setTestResults: (tabId: string, results: TabTestResults | undefined) => void;
}

function sorted(tabs: TabState[]): TabState[] {
  return [...tabs].sort((a, b) => a.sortOrder - b.sortOrder);
}

export const useTabs = create<TabStore>((set, get) => ({
  tabs: [],
  responses: {},
  sending: {},
  testResults: {},

  hydrate: (tabs) =>
    set({ tabs: sorted(tabs.map((t) => ({ ...t, kind: t.kind ?? 'request' }))) }),

  openRequest: (requestId) => {
    const { tabs } = get();
    const existing = tabs.find(
      (t) => t.kind === 'request' && t.requestId === requestId && !t.draft,
    );
    if (existing) {
      useUi.getState().update({ activeTabId: existing.id });
      return;
    }
    const workspaceId = useUi.getState().ui.activeWorkspaceId;
    const maxOrder = Math.max(0, ...tabs.map((t) => t.sortOrder));
    const tab = newTab({ workspaceId, requestId, sortOrder: maxOrder + 1 });
    set({ tabs: [...tabs, tab] });
    queuePut('tabs', tab);
    useUi.getState().update({ activeTabId: tab.id });
  },

  openCollection: (collectionId) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.kind === 'collection' && t.requestId === collectionId);
    if (existing) {
      useUi.getState().update({ activeTabId: existing.id });
      return;
    }
    const workspaceId = useUi.getState().ui.activeWorkspaceId;
    const maxOrder = Math.max(0, ...tabs.map((t) => t.sortOrder));
    const tab = newTab({
      workspaceId,
      kind: 'collection',
      requestId: collectionId,
      sortOrder: maxOrder + 1,
    });
    set({ tabs: [...tabs, tab] });
    queuePut('tabs', tab);
    useUi.getState().update({ activeTabId: tab.id });
  },

  openDraft: (partial = {}) => {
    const { tabs } = get();
    const workspaceId = useUi.getState().ui.activeWorkspaceId;
    const draft = newRequest({ workspaceId, name: 'Untitled Request', ...partial });
    const maxOrder = Math.max(0, ...tabs.map((t) => t.sortOrder));
    const tab = newTab({ workspaceId, requestId: draft.id, draft, sortOrder: maxOrder + 1 });
    set({ tabs: [...tabs, tab] });
    queuePut('tabs', tab);
    useUi.getState().update({ activeTabId: tab.id });
    return tab;
  },

  requestClose: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (isUnsavedDraft(tab)) {
      const behavior = useSettings.getState().settings.closeDraftBehavior;
      if (behavior === 'ask') {
        useUi.getState().setCloseTabPrompt(tabId);
        return;
      }
      if (behavior === 'save') {
        useUi.getState().setSaveRequestCloseAfter(true);
        useUi.getState().setDialog('saveRequest', tabId);
        return;
      }
    }
    get().close(tabId);
  },

  close: (tabId) => {
    const { tabs, responses, sending } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    // drop any live WebSocket/Socket.IO connection owned by this tab
    void import('./realtime').then((m) => m.useRealtime.getState().disconnect(tabId));
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    const nextResponses = { ...responses };
    delete nextResponses[tabId];
    const nextSending = { ...sending };
    delete nextSending[tabId];
    set({ tabs: nextTabs, responses: nextResponses, sending: nextSending });
    queueDelete('tabs', tabId);

    const ui = useUi.getState().ui;
    if (ui.splitTabId === tabId) {
      useUi.getState().update({ splitTabId: null });
    }
    if (ui.activeTabId === tabId) {
      const ordered = sorted(nextTabs);
      const fallback = ordered[Math.min(idx, ordered.length - 1)] ?? null;
      useUi.getState().update({ activeTabId: fallback?.id ?? null });
    }
  },

  closeOthers: (tabId) => {
    get().closeMany((t) => t.id !== tabId && !t.pinned);
  },

  closeAll: () => {
    get().closeMany((t) => !t.pinned);
  },

  /**
   * Close every tab matching `shouldClose`. Tabs with unsaved draft edits are
   * routed through requestClose so they honor closeDraftBehavior (prompting
   * under "ask") — the same flow as closing a single tab. Only the clean tabs
   * are dropped immediately.
   */
  closeMany: (shouldClose) => {
    const { tabs } = get();
    const targets = tabs.filter(shouldClose);
    if (targets.length === 0) return;

    const clean = targets.filter((t) => !isUnsavedDraft(t));
    const dirty = targets.filter((t) => isUnsavedDraft(t));

    if (clean.length > 0) {
      const cleanIds = new Set(clean.map((t) => t.id));
      void import('./realtime').then((m) => {
        for (const t of clean) m.useRealtime.getState().disconnect(t.id);
      });
      for (const t of clean) queueDelete('tabs', t.id);

      const { responses, sending } = get();
      const nextResponses = { ...responses };
      const nextSending = { ...sending };
      for (const id of cleanIds) {
        delete nextResponses[id];
        delete nextSending[id];
      }
      const remaining = tabs.filter((t) => !cleanIds.has(t.id));
      set({ tabs: remaining, responses: nextResponses, sending: nextSending });

      const ui = useUi.getState().ui;
      if (ui.splitTabId && cleanIds.has(ui.splitTabId)) {
        useUi.getState().update({ splitTabId: null });
      }
      if (ui.activeTabId && cleanIds.has(ui.activeTabId)) {
        const fallback = sorted(remaining)[0] ?? null;
        useUi.getState().update({ activeTabId: fallback?.id ?? null });
      }
    }

    // Each unsaved draft goes through the normal save-before-close flow.
    for (const t of dirty) get().requestClose(t.id);
  },

  activate: (tabId) => {
    useUi.getState().update({ activeTabId: tabId });
  },

  togglePin: (tabId) => {
    const tabs = get().tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t));
    set({ tabs });
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) queuePut('tabs', tab);
  },

  duplicate: (tabId) => {
    const src = get().tabs.find((t) => t.id === tabId);
    if (!src) return;
    if (src.kind === 'collection') {
      const copy = useData.getState().duplicateCollection(src.requestId);
      if (copy) get().openCollection(copy.id);
      return;
    }
    if (src.draft) {
      const draft = { ...structuredClone(src.draft), id: crypto.randomUUID() };
      get().openDraft(draft);
    } else {
      const copy = useData.getState().duplicateRequest(src.requestId);
      if (copy) get().openRequest(copy.id);
    }
  },

  reorder: (tabId, beforeTabId) => {
    const ordered = sorted(get().tabs);
    const moving = ordered.find((t) => t.id === tabId);
    if (!moving) return;
    const rest = ordered.filter((t) => t.id !== tabId);
    const insertAt = beforeTabId ? rest.findIndex((t) => t.id === beforeTabId) : rest.length;
    const next = [...rest];
    next.splice(insertAt === -1 ? rest.length : insertAt, 0, moving);
    const renumbered = next.map((t, i) => ({ ...t, sortOrder: i + 1 }));
    set({ tabs: renumbered });
    renumbered.forEach((t) => queuePut('tabs', t));
  },

  updateDraft: (tabId, patch) => {
    const tabs = get().tabs.map((t) =>
      t.id === tabId && t.draft
        ? { ...t, draft: { ...t.draft, ...patch, updatedAt: now() } }
        : t,
    );
    set({ tabs });
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) queuePut('tabs', tab);
  },

  saveDraftTo: (tabId, collectionId, folderId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.draft) return;
    const request: ApiRequest = { ...tab.draft, collectionId, folderId, updatedAt: now() };
    useData.getState().upsertRequest(request);
    const tabs = get().tabs.map((t) => (t.id === tabId ? { ...t, draft: null } : t));
    set({ tabs });
    const saved = tabs.find((t) => t.id === tabId);
    if (saved) queuePut('tabs', saved);
  },

  setResponse: (tabId, response) =>
    set({ responses: { ...get().responses, [tabId]: response } }),

  setSending: (tabId, sending) => set({ sending: { ...get().sending, [tabId]: sending } }),

  setTestResults: (tabId, results) =>
    set({ testResults: { ...get().testResults, [tabId]: results } }),
}));
