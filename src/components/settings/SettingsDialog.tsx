import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Code,
  Database,
  Download,
  GitBranch,
  Globe,
  Info,
  Network,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AppearancePane,
  CertificatesPane,
  DataPane,
  EditorPane,
  GitSyncPane,
  ProxyPane,
  RequestsPane,
} from './panes';
import { UpdatesPane } from './UpdatesPane';
import { AboutPane } from './AboutPane';

type TabId =
  | 'appearance'
  | 'editor'
  | 'requests'
  | 'proxy'
  | 'certificates'
  | 'git'
  | 'data'
  | 'updates'
  | 'about';

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  render: () => React.ReactNode;
}

const CATEGORIES: Array<{ label: string; tabs: TabDef[] }> = [
  {
    label: 'General',
    tabs: [
      { id: 'appearance', label: 'Theme', icon: Palette, render: () => <AppearancePane /> },
      { id: 'editor', label: 'Editor', icon: Code, render: () => <EditorPane /> },
    ],
  },
  {
    label: 'Network',
    tabs: [
      { id: 'requests', label: 'Requests', icon: Globe, render: () => <RequestsPane /> },
      { id: 'proxy', label: 'Proxy', icon: Network, render: () => <ProxyPane /> },
      {
        id: 'certificates',
        label: 'Certificates',
        icon: ShieldCheck,
        render: () => <CertificatesPane />,
      },
    ],
  },
  {
    label: 'Data',
    tabs: [
      { id: 'git', label: 'Git sync', icon: GitBranch, render: () => <GitSyncPane /> },
      { id: 'data', label: 'Backup & reset', icon: Database, render: () => <DataPane /> },
    ],
  },
  {
    label: 'Application',
    tabs: [
      { id: 'updates', label: 'Updates', icon: Download, render: () => <UpdatesPane /> },
      { id: 'about', label: 'About', icon: Info, render: () => <AboutPane /> },
    ],
  },
];

const ALL_TABS = CATEGORIES.flatMap((c) => c.tabs);

export function SettingsDialog() {
  const open = useUi((s) => s.openDialog === 'settings');
  const setDialog = useUi((s) => s.setDialog);
  const [tab, setTab] = React.useState<TabId>('appearance');
  const current = ALL_TABS.find((t) => t.id === tab) ?? ALL_TABS[0]!;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="flex h-[80vh] max-h-[640px] max-w-3xl gap-0 overflow-hidden p-0">
        <nav
          className="flex w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-muted/30 p-3"
          aria-label="Settings categories"
        >
          <DialogTitle className="px-2 pt-1 text-sm">Settings</DialogTitle>
          {CATEGORIES.map((category) => (
            <div key={category.label} className="flex flex-col gap-0.5">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {category.label}
              </div>
              {category.tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={tab === id ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    tab === id
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-5 pr-10">{current.render()}</div>
      </DialogContent>
    </Dialog>
  );
}
