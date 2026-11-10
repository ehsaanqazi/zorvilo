import * as React from 'react';
import { Folder } from 'lucide-react';
import type { Collection } from '@/types/models';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { formatTimestamp } from '@/lib/utils';
import { Input, Textarea } from '@/components/ui/input';
import { TabStrip } from '@/components/ui/misc';
import { AuthEditor } from '@/components/request/AuthEditor';
import { VariablesEditor } from '@/components/environments/VariablesEditor';
import { LazyCodeEditor } from '@/components/editor/LazyCodeEditor';

const TABS = ['overview', 'authorization', 'scripts', 'variables'] as const;
type CollectionTab = (typeof TABS)[number];

function Overview({ collection }: { collection: Collection }) {
  const updateCollection = useData((s) => s.updateCollection);
  const requestCount = useData(
    (s) => Object.values(s.requests).filter((r) => r.collectionId === collection.id).length,
  );
  const folderCount = useData(
    (s) => Object.values(s.folders).filter((f) => f.collectionId === collection.id).length,
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input
          value={collection.name}
          onChange={(e) => updateCollection(collection.id, { name: e.target.value })}
          className="max-w-md text-sm font-medium"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Description</span>
        <Textarea
          value={collection.description}
          placeholder="What is this collection for?"
          onChange={(e) => updateCollection(collection.id, { description: e.target.value })}
          className="min-h-28"
        />
      </label>
      <div className="flex gap-6 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{requestCount}</span> requests
        </span>
        <span>
          <span className="font-semibold text-foreground">{folderCount}</span> folders
        </span>
        <span>Created {formatTimestamp(collection.createdAt)}</span>
        <span>Updated {formatTimestamp(collection.updatedAt)}</span>
      </div>
    </div>
  );
}

function Scripts({ collection }: { collection: Collection }) {
  const updateCollection = useData((s) => s.updateCollection);
  const [which, setWhich] = React.useState<'pre' | 'test'>('pre');
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <TabStrip
          tabs={['pre', 'test'] as const}
          value={which}
          onChange={setWhich}
          labels={{ pre: 'Pre-request', test: 'Tests' }}
          className="border-b-0"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          Runs before/after every request in this collection — execution sandbox coming later.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <LazyCodeEditor
          value={which === 'pre' ? collection.preRequestScript : collection.testScript}
          language="javascript"
          onChange={(value) =>
            updateCollection(
              collection.id,
              which === 'pre' ? { preRequestScript: value } : { testScript: value },
            )
          }
        />
      </div>
    </div>
  );
}

function Variables({ collection }: { collection: Collection }) {
  const updateCollection = useData((s) => s.updateCollection);
  const globals = useEnvironments((s) => s.globals);
  const setGlobals = useEnvironments((s) => s.setGlobals);

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className="pb-1 text-xs font-semibold">Collection variables</div>
      <p className="pb-2 text-[11px] text-muted-foreground">
        Available to every request in this collection as {'{{variable}}'} (overridden by
        request-level variables).
      </p>
      <VariablesEditor
        variables={collection.variables}
        onChange={(variables) => updateCollection(collection.id, { variables })}
      />
      <div className="pb-1 pt-5 text-xs font-semibold">Global variables</div>
      <p className="pb-2 text-[11px] text-muted-foreground">
        Apply everywhere, across all workspaces (lowest precedence).
      </p>
      <VariablesEditor variables={globals} onChange={setGlobals} />
    </div>
  );
}

export function CollectionView({ collectionId }: { collectionId: string }) {
  const collection = useData((s) => s.collections[collectionId]);
  const updateCollection = useData((s) => s.updateCollection);
  const [tab, setTab] = React.useState<CollectionTab>('overview');

  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This collection no longer exists.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="truncate text-sm font-semibold">{collection.name}</span>
        <span className="text-xs text-muted-foreground">Collection</span>
      </div>
      <TabStrip
        tabs={TABS}
        value={tab}
        onChange={setTab}
        counts={{ variables: collection.variables.filter((v) => v.enabled && v.key).length }}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'overview' && (
          <div className="h-full overflow-y-auto">
            <Overview collection={collection} />
          </div>
        )}
        {tab === 'authorization' && (
          <div className="flex h-full flex-col overflow-y-auto">
            <p className="shrink-0 border-b px-4 py-2.5 text-[11px] text-muted-foreground">
              Requests in this collection with auth set to “Inherit from parent” use this
              configuration.
            </p>
            <div className="min-h-0 flex-1">
              <AuthEditor
                auth={collection.auth}
                onChange={(auth) => updateCollection(collection.id, { auth })}
              />
            </div>
          </div>
        )}
        {tab === 'scripts' && <Scripts collection={collection} />}
        {tab === 'variables' && <Variables collection={collection} />}
      </div>
    </div>
  );
}
