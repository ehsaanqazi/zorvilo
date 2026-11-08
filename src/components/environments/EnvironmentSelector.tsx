import { Check, Layers } from 'lucide-react';
import { useEnvironments } from '@/store/environments';
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

export function EnvironmentSelector() {
  const environments = useEnvironments((s) => s.environments);
  const setActiveEnvironment = useEnvironments((s) => s.setActiveEnvironment);
  const setDialog = useUi((s) => s.setDialog);
  const active = environments.find((e) => e.isActive);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 max-w-44 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-accent"
          title="Active environment"
        >
          <Layers className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          <span className="truncate">{active?.name ?? 'No environment'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Environment</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setActiveEnvironment(null)}>
          <Check className={cn('size-3.5', active && 'invisible')} />
          No environment
        </DropdownMenuItem>
        {environments.map((env) => (
          <DropdownMenuItem key={env.id} onSelect={() => setActiveEnvironment(env.id)}>
            <Check className={cn('size-3.5', !env.isActive && 'invisible')} />
            <span className="truncate">{env.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialog('environments')}>
          Manage environments…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
