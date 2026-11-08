import { Columns2, GitBranch, Layers, Rows2 } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useGit } from '@/store/git';
import { useEnvironments } from '@/store/environments';

/** Bottom toolbar: layout toggle + quick status (env, git branch). */
export function StatusBar() {
  const layout = useUi((s) => s.ui.requestLayout);
  const update = useUi((s) => s.update);
  const branch = useGit((s) => s.status?.branch ?? (s.hasRepo ? s.meta?.branch : undefined));
  const behind = useGit((s) => s.behind);
  const activeEnv = useEnvironments((s) => s.environments.find((e) => e.isActive)?.name);

  const isVertical = layout === 'vertical';

  return (
    <div className="relative flex h-6 shrink-0 select-none items-center gap-3 border-t bg-card px-2 text-[11px] text-muted-foreground">
      <button
        type="button"
        title={
          isVertical
            ? 'Switch to side-by-side layout (request left, response right)'
            : 'Switch to stacked layout (request top, response bottom)'
        }
        onClick={() => update({ requestLayout: isVertical ? 'horizontal' : 'vertical' })}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
      >
        {isVertical ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
        {isVertical ? 'Stacked' : 'Side-by-side'}
      </button>
      <span className="flex-1" />
      {activeEnv && (
        <span className="flex items-center gap-1">
          <Layers className="size-3" />
          {activeEnv}
        </span>
      )}
      {branch && (
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          {branch}
          {behind > 0 && <span className="text-primary">↓{behind}</span>}
        </span>
      )}
    </div>
  );
}
