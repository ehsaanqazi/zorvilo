import * as React from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, Lock } from 'lucide-react';
import { useWorkspaces } from '@/store/workspaces';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';
import { promptCreateWorkspace } from './createWorkspace';

interface WorkspacePickerProps {
  /** Renders the trigger; receives open state so it can style itself. */
  children: (open: boolean) => React.ReactElement;
  align?: 'start' | 'end';
}

const POPOVER_WIDTH = 288;

/** Postman-style workspace switcher popover: search, create, list, view all. */
export function WorkspacePicker({ children, align = 'start' }: WorkspacePickerProps) {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const switchTo = useWorkspaces((s) => s.switchTo);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const setDialog = useUi((s) => s.setDialog);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? workspaces.filter((w) => w.name.toLowerCase().includes(q)) : workspaces;
    // Active workspace first, like Postman.
    return [...list].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  }, [workspaces, query, activeId]);

  const place = React.useCallback(() => {
    const el = triggerRef.current?.firstElementChild ?? triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = align === 'end' ? r.right - POPOVER_WIDTH : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, [align]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    inputRef.current?.focus();
    const onResize = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, place, close]);

  React.useEffect(() => setHighlight(0), [query]);

  React.useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pick = (id: string) => {
    close();
    if (id !== activeId) void switchTo(id);
  };

  const onCreate = () => {
    const name = query.trim();
    close();
    void promptCreateWorkspace(name);
  };

  const onViewAll = () => {
    close();
    setDialog('workspaces');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ws = filtered[highlight];
      if (ws) pick(ws.id);
      else if (query.trim()) onCreate();
    }
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="contents"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {children(open)}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Switch workspace"
            onKeyDown={onKeyDown}
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
          >
            <div className="flex items-center gap-2 p-2.5">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workspaces..."
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={onCreate}
                className="h-8 shrink-0 rounded-md border border-input bg-transparent px-3 text-xs font-medium hover:bg-accent"
              >
                Create
              </button>
            </div>

            <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto px-1.5 pb-1.5">
              {filtered.length === 0 ? (
                <div className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                  No workspaces found
                  {query.trim() && (
                    <div className="mt-1 text-xs">
                      Press <span className="font-medium text-foreground">Enter</span> to create “
                      {query.trim()}”
                    </div>
                  )}
                </div>
              ) : (
                filtered.map((w, i) => {
                  const isActive = w.id === activeId;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-index={i}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(w.id)}
                      className={cn(
                        'flex h-8 w-full items-center gap-2.5 rounded-md px-1 text-left text-xs outline-none',
                        i === highlight && 'bg-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded',
                          isActive && 'bg-accent',
                        )}
                      >
                        <Lock className="size-3.5 text-muted-foreground" />
                      </span>
                      <span className={cn('truncate', isActive && 'font-semibold')}>{w.name}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t px-1.5 py-1.5">
              <button
                type="button"
                onClick={onViewAll}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs hover:bg-accent"
              >
                <LayoutGrid className="size-4 text-muted-foreground" />
                View all workspaces
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
