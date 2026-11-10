import { ChevronDown, Lock } from 'lucide-react';
import { useWorkspaces } from '@/store/workspaces';
import { useUi } from '@/store/ui';
import { WorkspacePicker } from '@/components/workspaces/WorkspacePicker';
import { cn } from '@/lib/utils';

export function WorkspaceSwitcher() {
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const active = useWorkspaces((s) => s.workspaces.find((w) => w.id === activeId));

  return (
    <WorkspacePicker>
      {(open) => (
        <button
          type="button"
          className={cn(
            'flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] hover:bg-accent',
            open && 'bg-accent',
          )}
          title="Switch workspace"
        >
          <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left font-semibold">
            {active?.name ?? 'Workspace'}
          </span>
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </button>
      )}
    </WorkspacePicker>
  );
}
