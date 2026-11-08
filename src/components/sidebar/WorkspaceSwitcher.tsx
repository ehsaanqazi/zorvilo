import { Boxes, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useWorkspaces } from '@/store/workspaces';
import { useUi } from '@/store/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const create = useWorkspaces((s) => s.create);
  const switchTo = useWorkspaces((s) => s.switchTo);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const setDialog = useUi((s) => s.setDialog);
  const active = workspaces.find((w) => w.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] hover:bg-accent"
          title="Switch workspace"
        >
          <Boxes className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left font-semibold">
            {active?.name ?? 'Workspace'}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => void switchTo(w.id)}>
            <Check className={cn('size-3.5', w.id !== activeId && 'invisible')} />
            <span className="truncate">{w.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void create('New Workspace').then((ws) => switchTo(ws.id));
          }}
        >
          <Plus /> New workspace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('workspaces')}>
          Manage workspaces…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
