import * as React from 'react';
import { Trash2 } from 'lucide-react';
import type { ApiRequest, KeyValue } from '@/types/models';
import { newKeyValue } from '@/lib/factories';
import { Checkbox } from '@/components/ui/misc';
import { Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { VariableInput } from './VariableText';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { buildVariableMap } from '@/features/variables/resolve';

function toBulkText(items: KeyValue[]): string {
  return items
    .map((i) => `${i.enabled ? '' : '//'}${i.key}:${i.value}`)
    .join('\n');
}

function fromBulkText(text: string, previous: KeyValue[]): KeyValue[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, index) => {
    let l = line.trim();
    const enabled = !l.startsWith('//');
    if (!enabled) l = l.slice(2).trim();
    const idx = l.indexOf(':');
    const key = (idx === -1 ? l : l.slice(0, idx)).trim();
    const value = idx === -1 ? '' : l.slice(idx + 1).trim();
    // keep stable ids for unchanged positions so focus/refs stay sane
    const prev = previous[index];
    return prev
      ? { ...prev, key, value, enabled }
      : newKeyValue({ key, value, enabled });
  });
}

/**
 * Generic key/value grid used by params, headers, cookies and form bodies.
 * Key-value mode keeps one empty trailing row (Postman-style); Bulk mode is a
 * plain-text `key:value` editor with `//` for disabled rows.
 */
export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = true,
  lockedKeys = false,
  emptyLabel,
  request,
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
  /**
   * Enables {{variable}} highlighting and hover cards on the value column.
   * Omit for grids that aren't part of a request (e.g. environment editors).
   */
  request?: ApiRequest;
  /**
   * Keys are owned elsewhere (path variables come from the URL): render them
   * read-only, and drop the enable/delete controls and trailing blank row.
   */
  lockedKeys?: boolean;
  /** Shown instead of the grid when there are no rows (locked-key mode). */
  emptyLabel?: string;
}) {
  const [bulk, setBulk] = React.useState(false);
  const [bulkText, setBulkText] = React.useState('');

  const collection = useData((s) =>
    request?.collectionId ? s.collections[request.collectionId] : undefined,
  );
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);
  const vars = React.useMemo(() => {
    if (!request) return new Map<string, string>();
    return buildVariableMap({
      request,
      collection: collection ?? null,
      environment: environments.find((e) => e.isActive) ?? null,
      globals,
    });
  }, [request, collection, environments, globals]);

  const enterBulk = () => {
    setBulkText(toBulkText(items));
    setBulk(true);
  };

  if (lockedKeys && items.length === 0) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        {emptyLabel ?? 'No rows.'}
      </p>
    );
  }

  if (bulk && !lockedKeys) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setBulk(false)}
          >
            Key-Value Edit
          </Button>
        </div>
        <Textarea
          value={bulkText}
          onChange={(e) => {
            setBulkText(e.target.value);
            onChange(fromBulkText(e.target.value, items));
          }}
          placeholder={'key:value\n//disabled-key:value'}
          spellCheck={false}
          className="min-h-32 font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          One <code className="font-mono">key:value</code> per line — prefix with{' '}
          <code className="font-mono">//</code> to disable a row.
        </p>
      </div>
    );
  }

  const rows = lockedKeys ? items : [...items, newKeyValue({ enabled: true })];

  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index === items.length) {
      // typing into the trailing empty row appends it
      onChange([...items, { ...rows[index]!, ...patch }]);
    } else {
      onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }
  };

  const CELL = 'flex min-w-0 items-center px-0.5';
  const HEAD = 'flex min-w-0 items-center px-2.5';

  return (
    <div className="flex flex-col border text-xs">
      {/* header row */}
      <div className="relative flex h-8 items-stretch border-b font-semibold text-muted-foreground">
        <span className="w-8 shrink-0 border-r" />
        <span className={`${HEAD} flex-1 border-r`}>Key</span>
        <span className={`${HEAD} flex-[1.4] ${showDescription ? 'xl:border-r' : ''}`}>
          Value
        </span>
        {showDescription && (
          <span className={`${HEAD} hidden flex-1 xl:flex`}>Description</span>
        )}
        {!lockedKeys && <span className="w-8 shrink-0" />}
        {!lockedKeys && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-6 -translate-y-1/2 px-1.5 font-semibold text-muted-foreground hover:text-foreground"
            onClick={enterBulk}
          >
            Bulk Edit
          </Button>
        )}
      </div>
      {rows.map((row, i) => {
        const isGhost = i === items.length;
        return (
          <div
            key={row.id}
            className="group flex min-h-8 items-stretch border-b last:border-b-0 hover:bg-muted/60"
          >
            <div className="flex w-8 shrink-0 items-center justify-center border-r">
              {!lockedKeys && !isGhost && (
                <Checkbox
                  checked={row.enabled}
                  onCheckedChange={(checked) => update(i, { enabled: checked === true })}
                  className="shrink-0"
                />
              )}
            </div>
            <div className={`${CELL} flex-1 border-r`}>
              {lockedKeys ? (
                <span
                  title={row.key}
                  className="h-7 flex-1 truncate px-2 py-1 font-mono text-xs text-muted-foreground"
                >
                  {row.key}
                </span>
              ) : request ? (
                <VariableInput
                  request={request}
                  value={row.key}
                  onChange={(key) => update(i, { key })}
                  placeholder={keyPlaceholder}
                  vars={vars}
                  className="flex-1"
                />
              ) : (
                <Input
                  value={row.key}
                  placeholder={keyPlaceholder}
                  onChange={(e) => update(i, { key: e.target.value })}
                  className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
                />
              )}
            </div>
            <div
              className={`${CELL} flex-[1.4] ${showDescription ? 'xl:border-r' : ''}`}
            >
              {request ? (
                <VariableInput
                  request={request}
                  value={row.value}
                  onChange={(value) => update(i, { value })}
                  placeholder={valuePlaceholder}
                  vars={vars}
                  className="flex-1"
                />
              ) : (
                <Input
                  value={row.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
                />
              )}
            </div>
            {showDescription && (
              <div className={`${CELL} hidden flex-1 xl:flex`}>
                <Input
                  value={row.description ?? ''}
                  placeholder="Description"
                  onChange={(e) => update(i, { description: e.target.value })}
                  className="h-7 flex-1 border-transparent px-2 text-xs focus-visible:border-input focus-visible:ring-0"
                />
              </div>
            )}
            {!lockedKeys && (
              <div className="flex w-8 shrink-0 items-center justify-center">
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Delete"
                  className={isGhost ? 'invisible' : 'invisible group-hover:visible'}
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
