import * as React from 'react';
import { Braces, FilePlus, Folder, FolderPlus, Pin, Plus, Radio, X, Zap } from 'lucide-react';
import { useTabs } from '@/store/tabs';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';
import { cn, requestBadge } from '@/lib/utils';
import { protocolPreset } from '@/lib/factories';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { TabState } from '@/types/models';

function TabItem({ tab }: { tab: TabState }) {
  const activeTabId = useUi((s) => s.ui.activeTabId);
  const isCollection = tab.kind === 'collection';
  const request = useData((s) =>
    isCollection ? undefined : tab.draft ? tab.draft : s.requests[tab.requestId],
  );
  const collection = useData((s) => (isCollection ? s.collections[tab.requestId] : undefined));
  const { activate, requestClose, closeOthers, closeAll, togglePin, duplicate, reorder } =
    useTabs();
  const [dragOver, setDragOver] = React.useState(false);

  const isActive = tab.id === activeTabId;
  const badge = request ? requestBadge(request) : { label: 'GET', className: '' };
  const title = (isCollection ? collection?.name : request?.name) || 'Untitled';
  const isDirty = !!tab.draft;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-tab-id', tab.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-tab-id')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const draggedId = e.dataTransfer.getData('application/x-tab-id');
            if (draggedId && draggedId !== tab.id) reorder(draggedId, tab.id);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              requestClose(tab.id);
            }
          }}
          onClick={() => activate(tab.id)}
          className={cn(
            'group flex h-10 min-w-0 w-44 max-w-52 shrink-0 cursor-default select-none items-center gap-1.5 border-r px-3 text-[13px]',
            isActive
              ? 'bg-background text-foreground shadow-[inset_0_2px_0_var(--primary)]'
              : 'bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            dragOver && 'bg-primary/10',
          )}
        >
          {tab.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          {isCollection ? (
            <Folder className="size-3.5 shrink-0 text-primary" />
          ) : (
            <span className={cn('shrink-0 font-mono text-[10px] font-semibold', badge.className)}>
              {badge.label}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {isDirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved" />}
          <button
            type="button"
            className="shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              requestClose(tab.id);
            }}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => togglePin(tab.id)}>
          {tab.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => duplicate(tab.id)}>Duplicate</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            const ui = useUi.getState();
            ui.update(
              ui.ui.splitTabId === tab.id ? { splitTabId: null } : { splitTabId: tab.id },
            );
          }}
        >
          {useUi.getState().ui.splitTabId === tab.id ? 'Close split view' : 'Open in split view'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => requestClose(tab.id)}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeOthers(tab.id)}>Close others</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeAll()}>Close all</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const reorder = useTabs((s) => s.reorder);
  const ordered = React.useMemo(
    () =>
      [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder),
    [tabs],
  );

  return (
    <div
      className="flex min-w-0 flex-1 items-center overflow-x-auto"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-tab-id')) e.preventDefault();
      }}
      onDrop={(e) => {
        const draggedId = e.dataTransfer.getData('application/x-tab-id');
        if (draggedId) reorder(draggedId, null); // drop on empty space = move to end
      }}
    >
      {ordered.map((tab) => (
        <TabItem key={tab.id} tab={tab} />
      ))}
      {/* Postman-style "+" right after the last tab */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="New… (Ctrl+N for request)"
            className="flex h-10 w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('http'))}>
            <FilePlus /> HTTP
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('graphql'))}>
            <Braces /> GraphQL
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('ws'))}>
            <Zap /> WebSocket
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('socketio'))}>
            <Radio /> Socket.IO
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              const ui = useUi.getState();
              const col = useData
                .getState()
                .createCollection(ui.ui.activeWorkspaceId, 'New Collection');
              ui.update({ sidebarSection: 'collections', sidebarCollapsed: false });
              ui.setExpanded(col.id, true);
            }}
          >
            <FolderPlus /> Collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
