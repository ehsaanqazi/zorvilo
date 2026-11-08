import * as React from 'react';
import {
  Folder,
  FolderTree,
  History,
  Layers,
  Moon,
  Plus,
  Save,
  Search,
  Settings,
  SunMedium,
  Variable as VariableIcon,
} from 'lucide-react';
import { useUi } from '@/store/ui';
import { useData } from '@/store/data';
import { useTabs } from '@/store/tabs';
import { useHistory } from '@/store/history';
import { useEnvironments } from '@/store/environments';
import { useSavedResponses } from '@/store/responses';
import { useSettings } from '@/store/settings';
import { useThemeState } from '@/hooks/useTheme';
import { cn, matches, methodColorClass } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/misc';

interface Item {
  id: string;
  group: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  run: () => void;
}

const MAX_PER_GROUP = 8;

function useItems(query: string): Item[] {
  const collections = useData((s) => s.collections);
  const folders = useData((s) => s.folders);
  const requests = useData((s) => s.requests);
  const history = useHistory((s) => s.entries);
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);
  const savedResponses = useSavedResponses((s) => s.savedResponses);
  const isDark = useThemeState((s) => s.isDark);

  return React.useMemo(() => {
    const ui = useUi.getState();
    const tabs = useTabs.getState();
    const settings = useSettings.getState();
    const items: Item[] = [];
    const q = query.trim();

    // Actions always searchable
    const actions: Item[] = [
      {
        id: 'a:new-request',
        group: 'Actions',
        icon: <Plus className="size-4" />,
        title: 'New request',
        subtitle: 'Ctrl+N',
        run: () => tabs.openDraft(),
      },
      {
        id: 'a:new-collection',
        group: 'Actions',
        icon: <FolderTree className="size-4" />,
        title: 'New collection',
        run: () => {
          useData.getState().createCollection(ui.ui.activeWorkspaceId, 'New Collection');
        },
      },
      {
        id: 'a:import',
        group: 'Actions',
        icon: <Save className="size-4" />,
        title: 'Import (Postman collection / environment)',
        run: () => ui.setDialog('import'),
      },
      {
        id: 'a:settings',
        group: 'Actions',
        icon: <Settings className="size-4" />,
        title: 'Open settings',
        run: () => ui.setDialog('settings'),
      },
      {
        id: 'a:git',
        group: 'Actions',
        icon: <FolderTree className="size-4" />,
        title: 'Git sync',
        run: () => ui.setDialog('git'),
      },
      {
        id: 'a:theme',
        group: 'Actions',
        // Toggle against the rendered theme, not the setting: 'system' and
        // 'dark-slate' are dark too, and comparing to 'dark' wastes a click.
        icon: isDark ? <SunMedium className="size-4" /> : <Moon className="size-4" />,
        title: 'Toggle theme',
        run: () => settings.update({ theme: isDark ? 'light' : 'dark' }),
      },
    ];
    items.push(...actions.filter((a) => matches(a.title, q)));

    let count = 0;
    for (const r of Object.values(requests)) {
      if (count >= MAX_PER_GROUP && q === '') break;
      if (
        matches(r.name, q) ||
        matches(r.url, q) ||
        matches(r.description, q) ||
        r.tags.some((t) => matches(t, q))
      ) {
        if (count++ >= MAX_PER_GROUP) continue;
        items.push({
          id: `r:${r.id}`,
          group: 'Requests',
          icon: (
            <span className={cn('font-mono text-[9px] font-bold', methodColorClass(r.method))}>
              {r.method}
            </span>
          ),
          title: r.name,
          subtitle: r.url,
          run: () => tabs.openRequest(r.id),
        });
      }
    }

    for (const c of Object.values(collections)) {
      if (matches(c.name, q) || matches(c.description, q)) {
        items.push({
          id: `c:${c.id}`,
          group: 'Collections',
          icon: <Folder className="size-4 text-primary" />,
          title: c.name,
          run: () => {
            useUi.getState().update({ sidebarSection: 'collections', sidebarCollapsed: false });
            useUi.getState().setExpanded(c.id, true);
          },
        });
      }
    }

    for (const f of Object.values(folders)) {
      if (q && matches(f.name, q)) {
        items.push({
          id: `f:${f.id}`,
          group: 'Folders',
          icon: <Folder className="size-4 text-muted-foreground" />,
          title: f.name,
          subtitle: collections[f.collectionId]?.name,
          run: () => {
            useUi.getState().update({ sidebarSection: 'collections', sidebarCollapsed: false });
            useUi.getState().setExpanded(f.collectionId, true);
            useUi.getState().setExpanded(f.id, true);
          },
        });
      }
    }

    for (const env of environments) {
      if (matches(env.name, q) || env.variables.some((v) => matches(v.key, q))) {
        items.push({
          id: `e:${env.id}`,
          group: 'Environments',
          icon: <Layers className="size-4 text-muted-foreground" />,
          title: env.name,
          subtitle: `${env.variables.length} variables`,
          run: () => useUi.getState().setDialog('environments'),
        });
      }
    }

    if (q) {
      for (const v of globals) {
        if (matches(v.key, q)) {
          items.push({
            id: `gv:${v.id}`,
            group: 'Variables',
            icon: <VariableIcon className="size-4 text-muted-foreground" />,
            title: v.key,
            subtitle: 'Global variable',
            run: () => useUi.getState().setDialog('environments'),
          });
        }
      }

      let hCount = 0;
      for (const h of history) {
        if (hCount >= MAX_PER_GROUP) break;
        if (matches(h.url, q) || matches(h.method, q)) {
          hCount++;
          items.push({
            id: `h:${h.id}`,
            group: 'History',
            icon: <History className="size-4 text-muted-foreground" />,
            title: `${h.method} ${h.url}`,
            subtitle: `${h.status} — ${new Date(h.timestamp).toLocaleString()}`,
            run: () => {
              const snapshot = structuredClone(h.snapshot);
              tabs.openDraft({ ...snapshot, id: crypto.randomUUID(), collectionId: '', folderId: null });
            },
          });
        }
      }

      for (const sr of savedResponses) {
        if (matches(sr.name, q) || matches(sr.url, q) || matches(sr.response.bodyText.slice(0, 2000), q)) {
          items.push({
            id: `sr:${sr.id}`,
            group: 'Saved responses',
            icon: <Save className="size-4 text-muted-foreground" />,
            title: sr.name,
            subtitle: `${sr.method} ${sr.url}`,
            run: () => tabs.openRequest(sr.requestId),
          });
        }
      }
    }

    return items;
  }, [query, collections, folders, requests, history, environments, globals, savedResponses, isDark]);
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const items = useItems(query);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  React.useEffect(() => setSelected(0), [query]);

  const run = (item: Item) => {
    setOpen(false);
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selected];
      if (item) run(item);
    }
  };

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  let lastGroup = '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-24 max-w-xl translate-y-0 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search requests, collections, history, variables…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-96 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">No results</div>
          )}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <React.Fragment key={item.id}>
                {showGroup && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                    i === selected && 'bg-accent',
                  )}
                >
                  <span className="flex w-8 shrink-0 items-center justify-center">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{item.title}</span>
                    {item.subtitle && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
