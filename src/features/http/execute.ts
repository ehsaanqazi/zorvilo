import type {
  ApiRequest,
  Collection,
  Folder,
  ResponseData,
  TestResult,
  Variable,
} from '@/types/models';
import { useTabs } from '@/store/tabs';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { useSettings } from '@/store/settings';
import { useUi, toast } from '@/store/ui';
import { useHistory } from '@/store/history';
import { buildVariableMap } from '@/features/variables/resolve';
import { newVariable } from '@/lib/factories';
import { uid } from '@/lib/utils';
import { invoke } from '@/platform/tauri';

export function getTabRequest(tabId: string): ApiRequest | null {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  return tab.draft ?? useData.getState().requests[tab.requestId] ?? null;
}

/** Update a tab's request wherever it lives (draft on the tab, or the store). */
export function updateTabRequest(tabId: string, patch: Partial<ApiRequest>): void {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.draft) useTabs.getState().updateDraft(tabId, patch);
  else useData.getState().updateRequest(tab.requestId, patch);
}

/** Variable map for UI display (highlighting, hovers, realtime URLs). Sending resolves in Rust. */
export function buildScopeVariableMap(request: ApiRequest): Map<string, string> {
  const { collections } = useData.getState();
  const { environments, globals } = useEnvironments.getState();
  return buildVariableMap({
    request,
    collection: request.collectionId ? collections[request.collectionId] : null,
    environment: environments.find((e) => e.isActive) ?? null,
    globals,
  });
}

/** Folder chain from the collection root down to the request's folder. */
function folderChain(folderId: string | null): Folder[] {
  const { folders } = useData.getState();
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let current = folderId ? folders[folderId] : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? folders[current.parentId] : undefined;
  }
  return chain;
}

/** Snapshot of everything the backend needs to run (or generate code for) a request. */
export function requestContext(request: ApiRequest) {
  const collection: Collection | null = request.collectionId
    ? (useData.getState().collections[request.collectionId] ?? null)
    : null;
  const { environments, globals } = useEnvironments.getState();
  return {
    request,
    collection,
    folderChain: folderChain(request.folderId),
    environment: environments.find((e) => e.isActive) ?? null,
    globals,
    settings: useSettings.getState().settings,
  };
}

type Change = [string, string | null];

interface ExecuteOutput {
  response: ResponseData;
  tests: TestResult[];
  logs: string[];
  scriptError: string | null;
  changes: { environment: Change[]; globals: Change[]; collection: Change[] };
  sent: { method: string; url: string; headers: [string, string][]; bodyPreview: string };
  nextRequest?: { name: string | null } | null;
  scriptMs: number;
}

export interface ExecutionResult {
  response: ResponseData;
  tests: TestResult[];
  logs: string[];
  scriptError: string | null;
  /** `pm.execution.setNextRequest` — undefined when not called, null name = stop */
  nextRequest?: { name: string | null } | null;
}

function upsertVariables(variables: Variable[], changes: Change[]): Variable[] {
  let next = [...variables];
  for (const [key, value] of changes) {
    if (value === null) {
      next = next.filter((v) => v.key !== key);
    } else {
      const idx = next.findIndex((v) => v.key === key);
      if (idx >= 0) next[idx] = { ...next[idx]!, value, enabled: true };
      else next.push(newVariable({ key, value }));
    }
  }
  return next;
}

/** Persist pm.environment / pm.globals / pm.collectionVariables writes to the stores. */
function applyVariableChanges(changes: ExecuteOutput['changes'], collectionId: string) {
  const envStore = useEnvironments.getState();
  if (changes.environment.length > 0) {
    const active = envStore.environments.find((e) => e.isActive);
    if (active) {
      envStore.updateEnvironment(active.id, {
        variables: upsertVariables(active.variables, changes.environment),
      });
    } else {
      // no active environment — land the writes in globals so they aren't lost
      envStore.setGlobals(upsertVariables(envStore.globals, changes.environment));
    }
  }
  if (changes.globals.length > 0) {
    const env = useEnvironments.getState();
    env.setGlobals(upsertVariables(env.globals, changes.globals));
  }
  if (changes.collection.length > 0 && collectionId) {
    const collection = useData.getState().collections[collectionId];
    if (collection) {
      useData.getState().updateCollection(collectionId, {
        variables: upsertVariables(collection.variables, changes.collection),
      });
    }
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'CancelledError';
  }
}

/**
 * Full request pipeline, executed by the Rust backend and shared by tabs and
 * the collection runner: inherited auth → pre-request scripts (collection →
 * folders → request) → variable resolution → auth signing → send → tests.
 * Script variable writes are persisted to the stores afterwards.
 */
export async function performRequest(
  request: ApiRequest,
  signal?: AbortSignal,
  run?: { iteration: number; iterationCount: number },
): Promise<ExecutionResult> {
  const opId = uid();
  const onAbort = () => void invoke('cancel_request', { opId });
  if (signal?.aborted) throw new CancelledError();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const out = await invoke<ExecuteOutput>('execute_request', {
      args: {
        opId,
        ...requestContext(request),
        iteration: run?.iteration ?? 0,
        iterationCount: run?.iterationCount ?? 1,
      },
    });
    applyVariableChanges(out.changes, request.collectionId);
    return {
      response: out.response,
      tests: out.tests,
      logs: out.logs,
      scriptError: out.scriptError,
      nextRequest: out.nextRequest,
    };
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    // backend/IPC failure: report it like a network error so callers (runner) keep going
    const message = err instanceof Error ? err.message : String(err);
    return {
      response: {
        status: 0,
        statusText: '',
        headers: [],
        bodyText: '',
        bodyBase64: null,
        contentType: '',
        sizeBytes: 0,
        durationMs: 0,
        timestamp: Date.now(),
        error: message,
      },
      tests: [],
      logs: [],
      scriptError: null,
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** In-flight request controllers, keyed by tab id (transient, not persisted). */
const inFlight = new Map<string, AbortController>();

/** Cancel the in-flight request for a tab, if any. */
export function cancelTab(tabId: string): void {
  inFlight.get(tabId)?.abort();
}

/** Send, store the response on the tab, and record history. */
export async function executeTab(tabId: string): Promise<void> {
  const tabsStore = useTabs.getState();
  const request = getTabRequest(tabId);
  if (!request) return;
  if (request.protocol === 'ws' || request.protocol === 'socketio') {
    return; // realtime tabs use Connect/Send, not the HTTP pipeline
  }
  if (!request.url.trim()) {
    toast('error', 'Enter a request URL first');
    return;
  }
  if (tabsStore.sending[tabId]) return;

  const controller = new AbortController();
  inFlight.set(tabId, controller);
  tabsStore.setSending(tabId, true);
  try {
    const result = await performRequest(request, controller.signal);
    // If the user cancelled, don't overwrite state with a stale/partial result.
    if (controller.signal.aborted) return;
    useTabs.getState().setResponse(tabId, result.response);
    useTabs.getState().setTestResults(tabId, {
      tests: result.tests,
      logs: result.logs,
      error: result.scriptError,
    });

    const workspaceId = useUi.getState().ui.activeWorkspaceId;
    useHistory.getState().record(workspaceId, request, result.response);
  } catch (err) {
    if (!(err instanceof CancelledError)) {
      toast('error', 'Request failed', err instanceof Error ? err.message : String(err));
    }
  } finally {
    inFlight.delete(tabId);
    useTabs.getState().setSending(tabId, false);
  }
}
