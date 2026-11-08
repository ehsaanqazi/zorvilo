import { ChevronDown, GitBranch, Plus, Search, Settings, Upload } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useGit } from '@/store/git';
import { useWorkspaces } from '@/store/workspaces';
import { useTabs } from '@/store/tabs';
import { protocolPreset } from '@/lib/factories';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** Workspaces dropdown in the header (switch / create / manage). */
function WorkspacesMenu() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const create = useWorkspaces((s) => s.create);
  const switchTo = useWorkspaces((s) => s.switchTo);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const setDialog = useUi((s) => s.setDialog);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded px-2 text-[13px] font-medium text-foreground hover:bg-accent"
        >
          Workspaces <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => void switchTo(w.id)}>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                w.id === activeId ? 'bg-primary' : 'bg-transparent',
              )}
            />
            <span className={cn('truncate', w.id === activeId && 'font-medium')}>{w.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void create('New Workspace').then((ws) => switchTo(ws.id))}>
          <Plus /> Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('workspaces')}>View all workspaces…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Postman-style "New" menu (also used in the sidebar header). */
export function NewMenu({ trigger }: { trigger: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Create new</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('http'))}>
          <span className="w-9 font-mono text-[10px] font-bold text-emerald-600">HTTP</span> HTTP request
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('graphql'))}>
          <span className="w-9 font-mono text-[10px] font-bold text-pink-600">GQL</span> GraphQL
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('ws'))}>
          <span className="w-9 font-mono text-[10px] font-bold text-cyan-600">WS</span> WebSocket
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('socketio'))}>
          <span className="w-9 font-mono text-[10px] font-bold text-indigo-600">SIO</span> Socket.IO
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            const ui = useUi.getState();
            ui.update({ sidebarSection: 'collections', sidebarCollapsed: false });
            void import('@/store/data').then(({ useData }) => {
              const col = useData.getState().createCollection(ui.ui.activeWorkspaceId, 'New Collection');
              ui.setExpanded(col.id, true);
            });
          }}
        >
          <span className="w-9 font-mono text-[10px] font-bold text-muted-foreground">COL</span> Collection
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUi.getState().openEnvironment('globals')}>
          <span className="w-9 font-mono text-[10px] font-bold text-muted-foreground">ENV</span> Environment
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** App header: workspaces, global search, Git and settings — modelled on Postman's top bar. */
export function TopBar() {
  const setDialog = useUi((s) => s.setDialog);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const workspaceName = useWorkspaces((s) => s.workspaces.find((w) => w.id === activeId)?.name);
  const gitBusy = useGit((s) => s.busy);
  const gitChanges = useGit((s) => s.status?.changedFiles.length ?? 0);

  return (
    <header className="flex h-11 shrink-0 select-none items-center gap-2 border-b bg-card px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <img src="/icon-192.png" alt="Zorvilo" title="Zorvilo" className="mr-2 size-6 rounded-md" />
        <WorkspacesMenu />
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">
          · {workspaceName ?? 'Workspace'}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border bg-muted px-3 text-[13px] text-muted-foreground transition-colors hover:border-input hover:bg-accent"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search Zorvilo</span>
        <kbd className="rounded border bg-background px-1.5 font-sans text-[10px]">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setDialog('import')}>
          <Upload /> Import
        </Button>
        <Tooltip content={gitChanges > 0 ? `Git sync — ${gitChanges} uncommitted change(s)` : 'Git sync'}>
          <Button
            variant="ghost"
            size="icon"
            className={cn('relative text-muted-foreground', gitBusy && 'animate-pulse text-primary')}
            onClick={() => setDialog('git')}
          >
            <GitBranch />
            {gitChanges > 0 && (
              <span
                aria-label={`${gitChanges} uncommitted changes`}
                className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
              >
                {gitChanges > 99 ? '99+' : gitChanges}
              </span>
            )}
          </Button>
        </Tooltip>
        <Tooltip content="Settings">
          <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => setDialog('settings')}>
            <Settings />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
