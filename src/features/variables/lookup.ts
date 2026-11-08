import * as React from 'react';
import type { ApiRequest } from '@/types/models';
import { DYNAMIC_VARIABLES, isDynamicVariable } from './resolve';
import { newVariable } from '@/lib/factories';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { useTabs } from '@/store/tabs';
import { updateTabRequest } from '@/features/http/execute';
import { toast } from '@/store/ui';

export interface VariableInfo {
  found: boolean;
  value: string;
  secret: boolean;
  /** where the winning definition lives */
  scope: 'request' | 'collection' | 'environment' | 'global' | null;
  scopeLabel: string;
}

const NOT_FOUND: VariableInfo = {
  found: false,
  value: '',
  secret: false,
  scope: null,
  scopeLabel: '',
};

/**
 * Resolve a single variable name with full precedence
 * (request > collection > active environment > global) and report its scope.
 */
export function lookupVariable(request: ApiRequest | null, name: string): VariableInfo {
  if (name.startsWith('$')) {
    if (isDynamicVariable(name)) {
      return {
        found: true,
        value: `generated at send time, e.g. ${DYNAMIC_VARIABLES[name]!()}`,
        secret: false,
        scope: 'global',
        scopeLabel: 'Dynamic',
      };
    }
    return NOT_FOUND;
  }
  const check = (
    vars: { key: string; value: string; enabled: boolean; secret: boolean }[] | undefined,
    scope: VariableInfo['scope'],
    scopeLabel: string,
  ): VariableInfo | null => {
    const v = vars?.find((v) => v.enabled && v.key === name);
    return v ? { found: true, value: v.value, secret: v.secret, scope, scopeLabel } : null;
  };

  const { collections } = useData.getState();
  const { environments, globals } = useEnvironments.getState();
  const collection = request?.collectionId ? collections[request.collectionId] : undefined;
  const environment = environments.find((e) => e.isActive);

  return (
    check(request?.variables, 'request', 'Request') ??
    check(collection?.variables, 'collection', `Collection · ${collection?.name ?? ''}`) ??
    check(environment?.variables, 'environment', `Environment · ${environment?.name ?? ''}`) ??
    check(globals, 'global', 'Global') ??
    NOT_FOUND
  );
}

/**
 * Reactive lookup for editors: identity changes whenever any variable source
 * changes, so Monaco decorations re-run.
 */
export function useVariableLookup(request: ApiRequest): (name: string) => VariableInfo {
  const collection = useData((s) =>
    request.collectionId ? s.collections[request.collectionId] : undefined,
  );
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);

  return React.useMemo(
    () => (name: string) => lookupVariable(request, name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request.variables, request.collectionId, collection, environments, globals],
  );
}

export interface VariableSuggestion {
  name: string;
  value: string;
  secret: boolean;
  scopeLabel: string;
}

/**
 * Every variable usable in the current scope (deduped by precedence) plus the
 * dynamic `$` variables — powers `{{` autocomplete in the URL bar and editors.
 */
export function useVariableSuggestions(request: ApiRequest): () => VariableSuggestion[] {
  const collection = useData((s) =>
    request.collectionId ? s.collections[request.collectionId] : undefined,
  );
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);

  return React.useMemo(() => {
    return () => {
      const out: VariableSuggestion[] = [];
      const seen = new Set<string>();
      const add = (
        vars: { key: string; value: string; enabled: boolean; secret: boolean }[] | undefined,
        scopeLabel: string,
      ) => {
        for (const v of vars ?? []) {
          if (!v.enabled || !v.key || seen.has(v.key)) continue;
          seen.add(v.key);
          out.push({ name: v.key, value: v.value, secret: v.secret, scopeLabel });
        }
      };
      const environment = environments.find((e) => e.isActive);
      add(request.variables, 'Request');
      add(collection?.variables, 'Collection');
      add(environment?.variables, `Env · ${environment?.name ?? ''}`);
      add(globals, 'Global');
      for (const name of Object.keys(DYNAMIC_VARIABLES)) {
        out.push({ name, value: DYNAMIC_VARIABLES[name]!(), secret: false, scopeLabel: 'Dynamic' });
      }
      return out;
    };
     
  }, [request.variables, collection, environments, globals]);
}

/**
 * Update an existing variable in place, in whichever scope currently defines
 * it, so editing from a hover card doesn't silently shadow the original with a
 * new environment entry. Falls back to a quick add when it isn't defined yet.
 */
export function updateVariableValue(
  request: ApiRequest | null,
  name: string,
  value: string,
): string {
  const info = lookupVariable(request, name);
  if (!info.found || info.scope === null) return quickAddVariable(name, value);

  const setIn = <T extends { key: string; value: string; enabled: boolean }>(vars: T[]): T[] =>
    vars.map((v) => (v.enabled && v.key === name ? { ...v, value } : v));

  switch (info.scope) {
    case 'request': {
      if (!request) return quickAddVariable(name, value);
      // Request-scoped variables live on the open tab's draft.
      const tab = useTabs.getState().tabs.find((t) => (t.draft ?? null)?.id === request.id)
        ?? useTabs.getState().tabs.find((t) => t.requestId === request.id);
      if (!tab) return quickAddVariable(name, value);
      updateTabRequest(tab.id, { variables: setIn(request.variables) });
      toast('success', 'Variable updated', `{{${name}}} updated for this request.`);
      return 'Request';
    }
    case 'collection': {
      const data = useData.getState();
      const collection = request?.collectionId ? data.collections[request.collectionId] : undefined;
      if (!collection) return quickAddVariable(name, value);
      data.updateCollection(collection.id, { variables: setIn(collection.variables) });
      toast('success', 'Variable updated', `{{${name}}} updated in collection.`);
      return `Collection · ${collection.name}`;
    }
    case 'environment': {
      const envs = useEnvironments.getState();
      const active = envs.environments.find((e) => e.isActive);
      if (!active) return quickAddVariable(name, value);
      envs.updateEnvironment(active.id, { variables: setIn(active.variables) });
      toast('success', 'Variable updated', `{{${name}}} updated in "${active.name}".`);
      return `Environment · ${active.name}`;
    }
    case 'global': {
      const envs = useEnvironments.getState();
      envs.setGlobals(setIn(envs.globals));
      toast('success', 'Variable updated', `{{${name}}} updated in globals.`);
      return 'Globals';
    }
  }
}

/**
 * Postman-style quick add: write the value into the active environment,
 * falling back to globals when no environment is active.
 */
export function quickAddVariable(name: string, value: string): string {
  const envs = useEnvironments.getState();
  const active = envs.environments.find((e) => e.isActive);
  if (active) {
    const existing = active.variables.find((v) => v.key === name);
    const variables = existing
      ? active.variables.map((v) => (v.key === name ? { ...v, value, enabled: true } : v))
      : [...active.variables, newVariable({ key: name, value })];
    envs.updateEnvironment(active.id, { variables });
    toast('success', `Variable saved`, `{{${name}}} added to environment "${active.name}".`);
    return active.name;
  }
  const existing = envs.globals.find((v) => v.key === name);
  const globals = existing
    ? envs.globals.map((v) => (v.key === name ? { ...v, value, enabled: true } : v))
    : [...envs.globals, newVariable({ key: name, value })];
  envs.setGlobals(globals);
  toast('success', `Variable saved`, `{{${name}}} added to globals.`);
  return 'Globals';
}
