import { create } from 'zustand';
import type { UiState } from '@/types/models';
import { defaultUiState } from '@/lib/factories';
import { queueSetting } from '@/db/persistence';
import { uid } from '@/lib/utils';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}

export type DialogName =
  | 'settings'
  | 'git'
  | 'environments'
  | 'import'
  | 'workspaces'
  | 'saveRequest'
  | 'runner'
  | 'export'
  | null;

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export interface ChoiceOption {
  label: string;
  value: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
}

/** Multi-option prompt (e.g. import conflicts: replace / keep both / cancel). */
export interface ChoiceState {
  title: string;
  message: string;
  options: ChoiceOption[];
  /** receives the chosen option value, or null when cancelled/dismissed */
  onSelect: (value: string | null) => void;
}

/** Single-line text prompt (in-app replacement for window.prompt). */
export interface TextPromptState {
  title: string;
  placeholder?: string;
  initialValue?: string;
  /** optional helper text under the title */
  description?: string;
  /** submit button label (default "Save") */
  confirmLabel?: string;
  /** render the input in a monospace font (default true) */
  monospace?: boolean;
  /** disable submit while the trimmed value is empty */
  required?: boolean;
  /** receives the entered text, or null when cancelled */
  onSubmit: (value: string | null) => void;
}

interface UiStore {
  ui: UiState;
  ready: boolean;
  bootError: string | null;
  openDialog: DialogName;
  /** request id being saved via the "save draft to collection" dialog */
  saveRequestTabId: string | null;
  paletteOpen: boolean;
  toasts: Toast[];
  confirmState: ConfirmState | null;
  choiceState: ChoiceState | null;
  textPrompt: TextPromptState | null;
  /** what the collection runner dialog should run */
  runnerTarget: { collectionId: string; folderId: string | null } | null;
  /** environment id the Environments dialog should open to, or 'globals' */
  environmentsTarget: string | null;
  /** tab awaiting the "save before closing?" decision */
  closeTabPromptId: string | null;
  /** close the tab after SaveRequestDialog finishes saving */
  saveRequestCloseAfter: boolean;
  /** saved response the request's response panel should open (sidebar click) */
  savedResponseFocus: { requestId: string; savedId: string } | null;

  hydrate: (ui: UiState) => void;
  setReady: (ready: boolean) => void;
  setBootError: (err: string | null) => void;
  update: (patch: Partial<UiState>) => void;
  setDialog: (dialog: DialogName, saveRequestTabId?: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  toggleExpanded: (nodeId: string) => void;
  setExpanded: (nodeId: string, expanded: boolean) => void;
  toast: (kind: Toast['kind'], title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  requestConfirm: (confirm: ConfirmState) => void;
  closeConfirm: () => void;
  requestChoice: (choice: ChoiceState) => void;
  resolveChoice: (value: string | null) => void;
  requestText: (prompt: TextPromptState) => void;
  resolveText: (value: string | null) => void;
  openRunner: (collectionId: string, folderId: string | null) => void;
  openEnvironment: (id: string) => void;
  setCloseTabPrompt: (tabId: string | null) => void;
  setSaveRequestCloseAfter: (value: boolean) => void;
  focusSavedResponse: (requestId: string, savedId: string) => void;
  clearSavedResponseFocus: () => void;
}

function persist(ui: UiState) {
  queueSetting('ui', ui);
}

export const useUi = create<UiStore>((set, get) => ({
  ui: defaultUiState(),
  ready: false,
  bootError: null,
  openDialog: null,
  saveRequestTabId: null,
  paletteOpen: false,
  toasts: [],
  confirmState: null,
  choiceState: null,
  textPrompt: null,
  runnerTarget: null,
  environmentsTarget: null,
  closeTabPromptId: null,
  saveRequestCloseAfter: false,
  savedResponseFocus: null,

  hydrate: (ui) => set({ ui }),
  setReady: (ready) => set({ ready }),
  setBootError: (bootError) => set({ bootError }),
  update: (patch) => {
    const ui = { ...get().ui, ...patch };
    set({ ui });
    persist(ui);
  },
  setDialog: (openDialog, saveRequestTabId = null) => set({ openDialog, saveRequestTabId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleExpanded: (nodeId) => {
    const { ui } = get();
    const expanded = ui.expandedNodes.includes(nodeId)
      ? ui.expandedNodes.filter((id) => id !== nodeId)
      : [...ui.expandedNodes, nodeId];
    const next = { ...ui, expandedNodes: expanded };
    set({ ui: next });
    persist(next);
  },
  setExpanded: (nodeId, isExpanded) => {
    const { ui } = get();
    const has = ui.expandedNodes.includes(nodeId);
    if (has === isExpanded) return;
    const expanded = isExpanded
      ? [...ui.expandedNodes, nodeId]
      : ui.expandedNodes.filter((id) => id !== nodeId);
    const next = { ...ui, expandedNodes: expanded };
    set({ ui: next });
    persist(next);
  },
  toast: (kind, title, detail) => {
    const t: Toast = { id: uid(), kind, title, detail };
    set({ toasts: [...get().toasts, t] });
    setTimeout(() => get().dismissToast(t.id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  requestConfirm: (confirmState) => set({ confirmState }),
  closeConfirm: () => set({ confirmState: null }),
  requestChoice: (choiceState) => set({ choiceState }),
  requestText: (textPrompt) => set({ textPrompt }),
  resolveText: (value) => {
    const prompt = get().textPrompt;
    set({ textPrompt: null });
    prompt?.onSubmit(value);
  },
  resolveChoice: (value) => {
    const choice = get().choiceState;
    set({ choiceState: null });
    choice?.onSelect(value);
  },
  openRunner: (collectionId, folderId) =>
    set({ openDialog: 'runner', runnerTarget: { collectionId, folderId } }),
  openEnvironment: (id) => set({ openDialog: 'environments', environmentsTarget: id }),
  setCloseTabPrompt: (closeTabPromptId) => set({ closeTabPromptId }),
  setSaveRequestCloseAfter: (saveRequestCloseAfter) => set({ saveRequestCloseAfter }),
  focusSavedResponse: (requestId, savedId) => set({ savedResponseFocus: { requestId, savedId } }),
  clearSavedResponseFocus: () => set({ savedResponseFocus: null }),
}));

export function toast(kind: Toast['kind'], title: string, detail?: string) {
  useUi.getState().toast(kind, title, detail);
}

/** Ask for a line of text; resolves null on cancel/dismiss. */
export function askText(
  title: string,
  placeholder?: string,
  initialValue?: string,
  options: Pick<TextPromptState, 'description' | 'confirmLabel' | 'monospace' | 'required'> = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    useUi.getState().requestText({ title, placeholder, initialValue, ...options, onSubmit: resolve });
  });
}

/** Await the user's pick among several options; resolves null on cancel/dismiss. */
export function askChoice(
  title: string,
  message: string,
  options: ChoiceOption[],
): Promise<string | null> {
  return new Promise((resolve) => {
    useUi.getState().requestChoice({ title, message, options, onSelect: resolve });
  });
}

/**
 * Ask before deleting — names the entity kind, as in Postman.
 * Collections/folders/requests/environments go to Trash (30-day retention);
 * pass `permanent: true` for things that are gone immediately.
 */
export function confirmDelete(
  kind: string,
  name: string,
  onConfirm: () => void,
  options: { permanent?: boolean } = {},
) {
  const permanent = options.permanent === true;
  useUi.getState().requestConfirm({
    title: `Delete ${kind}?`,
    message: permanent
      ? `The ${kind} "${name}" will be PERMANENTLY deleted. This action cannot be undone.`
      : `The ${kind} "${name}" will be moved to Trash and PERMANENTLY deleted after 30 days.`,
    confirmLabel: permanent ? 'Delete permanently' : 'Delete',
    onConfirm,
  });
}
