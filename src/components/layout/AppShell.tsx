import { Folder, History, Layers, Trash2 } from 'lucide-react';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

/** Width of the Postman-style rail (icon with its label underneath). */
const RAIL_WIDTH = 76;

/** Left rail: one icon + label per section, like Postman's sidebar tabs. */
function IconRail() {
  const section = useUi((s) => s.ui.sidebarSection);
  const collapsed = useUi((s) => s.ui.sidebarCollapsed);
  const update = useUi((s) => s.update);

  return (
    <nav
      style={{ width: RAIL_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-0.5 border-r bg-rail px-1 py-1.5"
    >
      {SECTIONS.map(({ key, icon: Icon, label }) => {
        const active = section === key && !collapsed;
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => {
              if (section === key) update({ sidebarCollapsed: !collapsed });
              else update({ sidebarSection: key, sidebarCollapsed: false });
            }}
            className={cn(
              'flex w-full select-none flex-col items-center gap-1 rounded px-0.5 py-2 text-[10px] leading-none transition-colors',
              active
                ? 'bg-highlight font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Sidebar header: workspace name with Postman's "New" and "Import" actions. */
function SidePanelHeader() {
  const setDialog = useUi((s) => s.setDialog);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
      <div className="min-w-0 flex-1">
        <WorkspaceSwitcher />
      </div>
      <NewMenu
        trigger={
          <Button variant="secondary" size="sm" className="h-6 px-2.5">
            New
          </Button>
        }
      />
      <Button
        variant="secondary"
        size="sm"
        className="h-6 px-2.5"
        onClick={() => setDialog('import')}
      >
        Import
      </Button>
    </div>
  );
}

function SidePanel() {
  const section = useUi((s) => s.ui.sidebarSection);
  return (
    <div className="h-full min-w-0">
      {section === 'collections' && <CollectionsPanel />}
      {section === 'environments' && <EnvironmentsPanel />}
      {section === 'history' && <HistoryPanel />}
      {section === 'trash' && <TrashPanel />}
      {section === 'workspaces' && <CollectionsPanel />}
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
        {/* Postman layout: workspace header spans the rail and the panel */}
        <div
          style={{ width: collapsed ? RAIL_WIDTH : RAIL_WIDTH + sidebarWidth }}
          className="flex shrink-0 flex-col bg-sidebar"
        >
          {!collapsed && <SidePanelHeader />}
          <div className="flex min-h-0 flex-1">
            <IconRail />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <SidePanel />
              </div>
            )}
          </div>
        </div>
        {!collapsed && (
          <Splitter
            orientation="vertical"
            onDrag={(delta) =>
              update({ sidebarWidth: Math.min(560, Math.max(200, sidebarWidth + delta)) })
            }
          />
        )}
        <div className="min-w-0 flex-1">
          <MainArea />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
