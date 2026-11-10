import * as React from 'react';
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Workspace } from '@/types/models';
import { useWorkspaces } from '@/store/workspaces';
import { useUi, toast, confirmDelete } from '@/store/ui';
import { cn, downloadBlob, formatTimestamp, slugify } from '@/lib/utils';
import { exportWorkspaceBundle } from '@/features/exporter/postman';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { promptCreateWorkspace } from './createWorkspace';

type SortKey = 'updated' | 'name' | 'created';

const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Last updated',
  name: 'Name (A–Z)',
  created: 'Date created',
};

/** Soft, stable colour per workspace for its avatar tile (Postman-style). */
const AVATAR_COLORS = [
  'bg-[#fff1eb] text-[#d23f0e] dark:bg-[#3d1e12] dark:text-[#ff8f66]',
  'bg-[#e7f0ff] text-[#0053b8] dark:bg-[#0f2440] dark:text-[#74aef6]',
  'bg-[#e5fff1] text-[#007f31] dark:bg-[#0c3a22] dark:text-[#6bdd9a]',
  'bg-[#f3ecfc] text-[#623497] dark:bg-[#2a1a40] dark:text-[#c0a8e1]',
  'bg-[#fff9e0] text-[#ad7a03] dark:bg-[#3d3104] dark:text-[#ffe47e]',
  'bg-[#ffebf5] text-[#a61468] dark:bg-[#3f0f2a] dark:text-[#f15eb0]',
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'W';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function WorkspaceAvatar({ workspace, size = 'md' }: { workspace: Workspace; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded font-semibold',
        size === 'lg' ? 'size-10 text-sm' : 'size-8 text-[11px]',
        avatarColor(workspace.id),
      )}
    >
      {initials(workspace.name)}
    </span>
  );
}

function WorkspaceRow({
  workspace,
  isActive,
  canDelete,
  onOpen,
  onExport,
}: {
  workspace: Workspace;
  isActive: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onExport: () => void;
}) {
  const { rename, remove, duplicate } = useWorkspaces();
  const [renaming, setRenaming] = React.useState(false);
  const [value, setValue] = React.useState(workspace.name);

  const commit = () => {
    const next = value.trim();
    if (next && next !== workspace.name) rename(workspace.id, next);
    setRenaming(false);
  };

  const startRename = () => {
    setValue(workspace.name);
    setRenaming(true);
  };

  return (
    <div
      role="row"
      onClick={() => !renaming && onOpen()}
      className={cn(
        'group grid cursor-pointer grid-cols-[minmax(0,1fr)_120px_150px_72px] items-center gap-4 border-b px-4 py-2.5 last:border-b-0',
        isActive ? 'bg-highlight/60' : 'hover:bg-muted',
      )}
    >
      {/* Name + description */}
      <div className="flex min-w-0 items-center gap-3">
        <WorkspaceAvatar workspace={workspace} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={value}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="h-7 max-w-80"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground group-hover:underline">
                {workspace.name}
              </span>
              {isActive && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-[#e5fff1] px-1.5 py-px text-[10px] font-semibold text-[#007f31] dark:bg-[#0c3a22] dark:text-[#6bdd9a]">
                  <Check className="size-2.5" strokeWidth={3} />
                  Current
                </span>
              )}
            </div>
          )}
          <div className="truncate pt-0.5 text-[11px] text-muted-foreground">
            {workspace.description || 'Collections, environments, history and Git sync'}
          </div>
        </div>
      </div>

      {/* Access */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0" />
        Personal
      </div>

      {/* Updated */}
      <div className="truncate text-xs text-muted-foreground" title={new Date(workspace.updatedAt).toLocaleString()}>
        {formatTimestamp(workspace.updatedAt)}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="iconSm"
          title="Rename"
          className="invisible text-muted-foreground group-hover:visible"
          onClick={startRename}
        >
          <Pencil />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              title="More actions"
              className="text-muted-foreground data-[state=open]:bg-highlight"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {!isActive && (
              <DropdownMenuItem onSelect={onOpen}>
                <LayoutGrid /> Open workspace
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={startRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void duplicate(workspace.id)}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>
              <Download /> Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canDelete}
              className="text-destructive focus:text-destructive [&_svg]:!text-destructive"
              onSelect={() =>
                confirmDelete('workspace', workspace.name, () => void remove(workspace.id), {
                  permanent: true,
                })
              }
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Postman-style "All workspaces" page: search, sort, create and manage workspaces. */
export function WorkspacesDialog() {
  const open = useUi((s) => s.openDialog === 'workspaces');
  const setDialog = useUi((s) => s.setDialog);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const switchTo = useWorkspaces((s) => s.switchTo);
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('updated');

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const active = workspaces.find((w) => w.id === activeId);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? workspaces.filter(
          (w) => w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q),
        )
      : [...workspaces];
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }, [workspaces, query, sort]);

  const exportWorkspace = async (workspace: Workspace) => {
    try {
      const bundle = await exportWorkspaceBundle(workspace.id);
      const saved = await downloadBlob(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
        `${slugify(workspace.name)}.workspace.json`,
      );
      if (saved) toast('success', 'Workspace exported');
    } catch (err) {
      toast('error', 'Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  const openWorkspace = (id: string) => {
    setDialog(null);
    if (id !== activeId) void switchTo(id);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent
        hideClose
        className="flex h-[min(720px,calc(100vh-48px))] w-[calc(100vw-48px)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-4 border-b px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold">All workspaces</DialogTitle>
            <DialogDescription className="pt-1">
              Each workspace has its own collections, environments, history and Git repo.
            </DialogDescription>
          </div>
          <Button variant="default" className="shrink-0" onClick={() => void promptCreateWorkspace(query.trim())}>
            <Plus /> Create Workspace
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Close"
            className="-mr-2 shrink-0 text-muted-foreground"
            onClick={() => setDialog(null)}
          >
            <X />
          </Button>
        </div>

        {/* Current workspace card */}
        {active && (
          <div className="shrink-0 px-6 pt-4">
            <div className="flex items-center gap-3 rounded-md border bg-muted px-4 py-3">
              <WorkspaceAvatar workspace={active} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Current workspace
                </div>
                <div className="truncate text-sm font-semibold">{active.name}</div>
              </div>
              <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <Clock className="size-3.5" />
                Updated {formatTimestamp(active.updatedAt)}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-2 px-6 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspaces"
              className="h-8 pl-8"
            />
          </div>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">Sort by</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 font-normal">
                <ArrowDownAZ className="text-muted-foreground" />
                {SORT_LABELS[sort]}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <DropdownMenuItem key={k} onSelect={() => setSort(k)}>
                  <Check className={cn(sort !== k && 'invisible')} />
                  {SORT_LABELS[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
            <div
              role="row"
              className="grid shrink-0 grid-cols-[minmax(0,1fr)_120px_150px_72px] gap-4 border-b bg-muted px-4 py-2 text-[11px] font-semibold text-muted-foreground"
            >
              <span>Name</span>
              <span>Access</span>
              <span>Last updated</span>
              <span />
            </div>
            <div role="table" className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-secondary">
                    <LayoutGrid className="size-5 text-muted-foreground" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">No workspaces found</div>
                    <div className="pt-1 text-xs text-muted-foreground">
                      No workspace matches “{query.trim()}”.
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void promptCreateWorkspace(query.trim())}
                  >
                    <Plus /> Create “{query.trim()}”
                  </Button>
                </div>
              ) : (
                visible.map((w) => (
                  <WorkspaceRow
                    key={w.id}
                    workspace={w}
                    isActive={w.id === activeId}
                    canDelete={workspaces.length > 1}
                    onOpen={() => openWorkspace(w.id)}
                    onExport={() => void exportWorkspace(w)}
                  />
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 pt-2 text-[11px] text-muted-foreground">
            {visible.length === workspaces.length
              ? `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`
              : `${visible.length} of ${workspaces.length} workspaces`}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
