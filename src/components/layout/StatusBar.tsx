import { Columns2, GitBranch, Layers, PanelLeftClose, PanelLeftOpen, Rows2 } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useGit } from '@/store/git';
import { useEnvironments } from '@/store/environments';

const ITEM =
  'flex h-5 items-center gap-1.5 rounded px-1.5 hover:bg-accent hover:text-foreground [&_svg]:size-3.5';

/** Bottom bar, laid out like Postman's: sidebar toggle + status left, pane layout right. */
export function StatusBar() {
  const layout = useUi((s) => s.ui.requestLayout);
  const collapsed = useUi((s) => s.ui.sidebarCollapsed);
  const update = useUi((s) => s.update);
  const branch = useGit((s) => s.status?.branch ?? (s.hasRepo ? s.meta?.branch : undefined));
  const behind = useGit((s) => s.behind);
  const activeEnv = useEnvironments((s) => s.environments.find((e) => e.isActive)?.name);

  const isVertical = layout === 'vertical';

  return (
    <div className="relative flex h-7 shrink-0 select-none items-center gap-1 border-t bg-card px-2 text-[11px] text-muted-foreground">
      <button
        type="button"
        title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        onClick={() => update({ sidebarCollapsed: !collapsed })}
        className={ITEM}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </button>
      {branch && (
        <span className="flex h-5 items-center gap-1.5 px-1.5 [&_svg]:size-3.5">
          <GitBranch />
          {branch}
          {behind > 0 && <span className="text-primary">↓{behind}</span>}
        </span>
      )}
      <span className="flex-1" />
      {activeEnv && (
        <span className="flex h-5 items-center gap-1.5 px-1.5 [&_svg]:size-3.5">
          <Layers />
          {activeEnv}
        </span>
      )}
      <button
        type="button"
        title={
          isVertical
            ? 'Switch to side-by-side layout (request left, response right)'
            : 'Switch to stacked layout (request top, response bottom)'
        }
        onClick={() => update({ requestLayout: isVertical ? 'horizontal' : 'vertical' })}
        className={ITEM}
      >
        {isVertical ? <Rows2 /> : <Columns2 />}
        {isVertical ? 'Stacked' : 'Side-by-side'}
      </button>
    </div>
  );
}
