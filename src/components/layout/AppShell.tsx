import { Folder, History, Layers, PanelLeftClose, PanelLeftOpen, Trash2 } from 'lucide-react';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { Splitter } from './Splitter';
import { CollectionsPanel } from '@/components/sidebar/CollectionsPanel';
import { EnvironmentsPanel } from '@/components/sidebar/EnvironmentsPanel';
import { HistoryPanel } from '@/components/sidebar/HistoryPanel';
import { TrashPanel } from '@/components/sidebar/TrashPanel';
import { StatusBar } from './StatusBar';
import { WorkspaceSwitcher } from '@/components/sidebar/WorkspaceSwitcher';
import { MainArea } from './MainArea';
import { NewMenu, TopBar } from './TopBar';
import type { UiState } from '@/types/models';

const SECTIONS: {
  key: UiState['sidebarSection'];
  icon: typeof Folder;
  label: string;
}[] = [
  { key: 'collections', icon: Folder, label: 'Collections' },
  { key: 'environments', icon: Layers, label: 'Environments' },
  { key: 'history', icon: History, label: 'History' },
  { key: 'trash', icon: Trash2, label: 'Trash' },
];

/** Left rail: icon per section, name shown in a tooltip on hover. */
function IconRail() {
  const section = useUi((s) => s.ui.sidebarSection);
  const collapsed = useUi((s) => s.ui.sidebarCollapsed);
  const update = useUi((s) => s.update);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-rail py-2">
      {SECTIONS.map(({ key, icon: Icon, label }) => {
        const active = section === key && !collapsed;
        return (
          <Tooltip key={key} content={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => {
                if (section === key) update({ sidebarCollapsed: !collapsed });
                else update({ sidebarSection: key, sidebarCollapsed: false });
              }}
              className={cn(
                'flex size-9 items-center justify-center rounded-md transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className={cn('size-[18px]', active && 'text-primary')} />
            </button>
          </Tooltip>
        );
      })}
      <div className="flex-1" />
      <Tooltip content={collapsed ? 'Show sidebar' : 'Hide sidebar'} side="right">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={() => update({ sidebarCollapsed: !collapsed })}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </Tooltip>
    </nav>
  );
}

/** Sidebar header: workspace name with Postman's "New" and "Import" actions. */
function SidePanelHeader() {
  const setDialog = useUi((s) => s.setDialog);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
      <div className="min-w-0 flex-1">
        <WorkspaceSwitcher />
      </div>
      <NewMenu
        trigger={
          <Button variant="outline" size="sm" className="h-7">
            New
          </Button>
        }
      />
      <Button variant="outline" size="sm" className="h-7" onClick={() => setDialog('import')}>
        Import
      </Button>
    </div>
  );
}

function SidePanel() {
  const section = useUi((s) => s.ui.sidebarSection);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <SidePanelHeader />
      <div className="min-h-0 flex-1">
        {section === 'collections' && <CollectionsPanel />}
        {section === 'environments' && <EnvironmentsPanel />}
        {section === 'history' && <HistoryPanel />}
        {section === 'trash' && <TrashPanel />}
        {section === 'workspaces' && <CollectionsPanel />}
      </div>
    </div>
  );
}

export function AppShell() {
  const collapsed = useUi((s) => s.ui.sidebarCollapsed);
  const sidebarWidth = useUi((s) => s.ui.sidebarWidth);
  const update = useUi((s) => s.update);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <IconRail />
        {!collapsed && (
          <>
            <div style={{ width: sidebarWidth }} className="shrink-0 bg-sidebar">
              <SidePanel />
            </div>
            <Splitter
              orientation="vertical"
              onDrag={(delta) =>
                update({ sidebarWidth: Math.min(560, Math.max(200, sidebarWidth + delta)) })
              }
            />
          </>
        )}
        <div className="min-w-0 flex-1">
          <MainArea />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
