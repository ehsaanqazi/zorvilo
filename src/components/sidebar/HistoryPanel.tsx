import * as React from 'react';
import { History, Star, Trash2 } from 'lucide-react';
import { useHistory } from '@/store/history';
import { useTabs } from '@/store/tabs';
import { useUi, confirmDelete } from '@/store/ui';
import { cn, formatDuration, formatTimestamp, matches, methodColorClass, statusColorClass } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { VirtualList } from '@/components/ui/virtual-list';
import { EmptyState } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HistoryEntry } from '@/types/models';

const ROW_HEIGHT = 44;

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const openDraft = useTabs((s) => s.openDraft);
  const { remove, toggleFavorite } = useHistory();

  const replay = () => {
    // Re-open as a draft populated from the snapshot (never mutates the original)
    const snapshot = structuredClone(entry.snapshot);
    openDraft({
      ...snapshot,
      id: crypto.randomUUID(),
      collectionId: '',
      folderId: null,
    });
  };

  return (
    <div
      onClick={replay}
      style={{ height: ROW_HEIGHT }}
      className="group flex cursor-default select-none flex-col justify-center gap-0.5 border-b border-border/50 px-2 hover:bg-accent/60"
      title="Click to replay"
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('font-mono text-[10px] font-semibold', methodColorClass(entry.method))}>
          {entry.method}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{entry.url}</span>
        <button
          type="button"
          className={cn('shrink-0', !entry.favorite && 'opacity-0 group-hover:opacity-60')}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(entry.id);
          }}
        >
          <Star className={cn('size-3', entry.favorite && 'fill-amber-400 text-amber-400')} />
        </button>
        <button
          type="button"
          className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            confirmDelete('history entry', `${entry.method} ${entry.url}`, () => remove(entry.id), {
              permanent: true,
            });
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={statusColorClass(entry.status)}>
          {entry.status || 'ERR'} {entry.statusText}
        </span>
        <span>{formatDuration(entry.durationMs)}</span>
        <span className="flex-1" />
        <span>{formatTimestamp(entry.timestamp)}</span>
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const entries = useHistory((s) => s.entries);
  const clear = useHistory((s) => s.clear);
  const workspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'favorites' | 'errors' | '2xx'>('all');

  const filtered = React.useMemo(
    () =>
      entries.filter((e) => {
        if (filter === 'favorites' && !e.favorite) return false;
        if (filter === 'errors' && e.status > 0 && e.status < 400) return false;
        if (filter === '2xx' && (e.status < 200 || e.status >= 300)) return false;
        return matches(e.url, query) || matches(e.method, query) || matches(String(e.status), query);
      }),
    [entries, query, filter],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2 pb-1.5">
        <Input
          placeholder="Search history"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7"
        />
        <Button
          variant="ghost"
          size="iconSm"
          title="Clear history"
          onClick={() =>
            confirmDelete(
              'history (all non-favorite entries)',
              'this workspace',
              () => clear(workspaceId),
              { permanent: true },
            )
          }
        >
          <Trash2 />
        </Button>
      </div>
      <div className="px-2 pb-1.5">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="h-7 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All requests</SelectItem>
            <SelectItem value="favorites">Favorites</SelectItem>
            <SelectItem value="2xx">Successful (2xx)</SelectItem>
            <SelectItem value="errors">Errors (4xx/5xx/failed)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {filtered.length > 0 ? (
        <VirtualList
          items={filtered}
          rowHeight={ROW_HEIGHT}
          className="min-h-0 flex-1"
          renderRow={(entry) => <HistoryRow key={entry.id} entry={entry} />}
        />
      ) : (
        <EmptyState icon={<History />} title="No history yet">
          Every request you send is recorded here automatically.
        </EmptyState>
      )}
    </div>
  );
}
