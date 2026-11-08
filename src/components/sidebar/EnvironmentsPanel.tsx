import { Check, Copy, Globe, Layers, Plus, Trash2 } from 'lucide-react';
import { useEnvironments } from '@/store/environments';
import { useUi, confirmDelete } from '@/store/ui';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function EnvironmentsPanel() {
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);
  const { createEnvironment, deleteEnvironment, duplicateEnvironment, setActiveEnvironment } =
    useEnvironments();
  const activeWorkspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const setDialog = useUi((s) => s.setDialog);
  const openEnvironment = useUi((s) => s.openEnvironment);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-2 pb-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Environments
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          title="New environment"
          onClick={() => createEnvironment(activeWorkspaceId, 'New Environment')}
        >
          <Plus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        <button
          type="button"
          onClick={() => openEnvironment('globals')}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-[13px] hover:bg-accent"
        >
          <Globe className="size-3.5 text-muted-foreground" />
          <span className="flex-1 truncate text-left">Globals</span>
          <span className="text-[11px] text-muted-foreground">{globals.length} vars</span>
        </button>
        {environments.length === 0 ? (
          <EmptyState icon={<Layers />} title="No environments">
            Environments hold workspace-level variables.
          </EmptyState>
        ) : (
          environments.map((env) => (
            <div
              key={env.id}
              className={cn(
                'group flex items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-accent',
                env.isActive && 'bg-accent/60',
              )}
            >
              <button
                type="button"
                title={env.isActive ? 'Active environment' : 'Set active'}
                onClick={() => setActiveEnvironment(env.isActive ? null : env.id)}
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  env.isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
              >
                {env.isActive && <Check className="size-3" />}
              </button>
              <button
                type="button"
                title="View details"
                onClick={() => openEnvironment(env.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {env.name}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {env.variables.length}
              </span>
              <div className="hidden shrink-0 items-center group-hover:flex">
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Duplicate"
                  onClick={() => duplicateEnvironment(env.id)}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Delete"
                  onClick={() => confirmDelete('environment', env.name, () => deleteEnvironment(env.id))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={() => setDialog('environments')}>
          Manage variables
        </Button>
      </div>
    </div>
  );
}
