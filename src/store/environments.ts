import { create } from 'zustand';
import type { Environment, ScopedVariable, Variable } from '@/types/models';
import { newEnvironment } from '@/lib/factories';
import { queueDelete, queuePut } from '@/db/persistence';
import { stashInTrash } from '@/features/trash/trash';
import { now, uid } from '@/lib/utils';

interface EnvStore {
  /** environments of the active workspace */
  environments: Environment[];
  /** global (cross-workspace) variables */
  globals: ScopedVariable[];

  hydrate: (environments: Environment[], globals: ScopedVariable[]) => void;

  createEnvironment: (workspaceId: string, name: string) => Environment;
  updateEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  duplicateEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  setEnvironmentVariables: (id: string, variables: Variable[]) => void;

  setGlobals: (variables: Variable[]) => void;
}

export const useEnvironments = create<EnvStore>((set, get) => ({
  environments: [],
  globals: [],

  hydrate: (environments, globals) => set({ environments, globals }),

  createEnvironment: (workspaceId, name) => {
    const env = newEnvironment({ workspaceId, name });
    set({ environments: [...get().environments, env] });
    queuePut('environments', env);
    return env;
  },

  updateEnvironment: (id, patch) => {
    const environments = get().environments.map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: now() } : e,
    );
    set({ environments });
    const env = environments.find((e) => e.id === id);
    if (env) queuePut('environments', env);
  },

  deleteEnvironment: (id) => {
    const trashed = get().environments.find((e) => e.id === id);
    if (trashed) {
      stashInTrash({
        workspaceId: trashed.workspaceId,
        kind: 'environment',
        name: trashed.name,
        payload: { environment: trashed },
      });
    }
    set({ environments: get().environments.filter((e) => e.id !== id) });
    queueDelete('environments', id);
  },

  duplicateEnvironment: (id) => {
    const src = get().environments.find((e) => e.id === id);
    if (!src) return;
    const copy: Environment = {
      ...structuredClone(src),
      id: uid(),
      name: `${src.name} Copy`,
      isActive: false,
      createdAt: now(),
      updatedAt: now(),
    };
    set({ environments: [...get().environments, copy] });
    queuePut('environments', copy);
  },

  setActiveEnvironment: (id) => {
    const environments = get().environments.map((e) => {
      const isActive = e.id === id;
      if (e.isActive !== isActive) {
        const next = { ...e, isActive };
        queuePut('environments', next);
        return next;
      }
      return e;
    });
    set({ environments });
  },

  setEnvironmentVariables: (id, variables) => {
    get().updateEnvironment(id, { variables });
  },

  setGlobals: (variables) => {
    const prev = get().globals;
    const next: ScopedVariable[] = variables.map((v) => ({ ...v, scope: 'global', ownerId: '' }));
    const nextIds = new Set(next.map((v) => v.id));
    for (const v of prev) {
      if (!nextIds.has(v.id)) queueDelete('variables', v.id);
    }
    next.forEach((v) => queuePut('variables', v));
    set({ globals: next });
  },
}));
