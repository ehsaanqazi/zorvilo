import * as React from 'react';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Import,
  Play,
  Plus,
  Radio,
  Star,
  Zap,
} from 'lucide-react';
import { useData } from '@/store/data';
import { useTabs } from '@/store/tabs';
import { useSavedResponses } from '@/store/responses';
import { useUi, toast, confirmDelete } from '@/store/ui';
import { cn, downloadBlob, matches, requestBadge, slugify, statusColorClass } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VirtualList } from '@/components/ui/virtual-list';
import { EmptyState } from '@/components/ui/misc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { exportPostmanCollection } from '@/features/exporter/postman';
import { generateCurl } from '@/features/codegen/generate';
import { copyText } from '@/platform/system';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { protocolPreset } from '@/lib/factories';
import type { ApiRequest, Collection, Folder as FolderModel, SavedResponse } from '@/types/models';

const ROW_HEIGHT = 26;

interface TreeRow {
  kind: 'collection' | 'folder' | 'request' | 'saved';
  id: string;
  depth: number;
  name: string;
  expanded?: boolean;
  request?: ApiRequest;
  /** request rows: number of saved responses (Postman "examples") nested under it */
  savedCount?: number;
  /** saved rows: the saved response itself */
  saved?: SavedResponse;
  collectionId: string;
  parentFolderId: string | null;
}

function useTreeRows(query: string): TreeRow[] {
  const collections = useData((s) => s.collections);
  const folders = useData((s) => s.folders);
  const requests = useData((s) => s.requests);
  const expandedNodes = useUi((s) => s.ui.expandedNodes);
  const savedResponses = useSavedResponses((s) => s.savedResponses);

  return React.useMemo(() => {
    const expanded = new Set(expandedNodes);
    const searching = query.trim().length > 0;
    const rows: TreeRow[] = [];

    const foldersByParent = new Map<string, FolderModel[]>();
    for (const f of Object.values(folders)) {
      const key = `${f.collectionId}:${f.parentId ?? ''}`;
      const list = foldersByParent.get(key) ?? [];
      list.push(f);
      foldersByParent.set(key, list);
    }
    const requestsByParent = new Map<string, ApiRequest[]>();
    for (const r of Object.values(requests)) {
      const key = `${r.collectionId}:${r.folderId ?? ''}`;
      const list = requestsByParent.get(key) ?? [];
      list.push(r);
      requestsByParent.set(key, list);
    }
    const bySort = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

    // Collections always render in ascending name order, numbers before letters,
    // with natural numeric ordering (e.g. "2 Foo" before "10 Foo").
    const byName = <T extends { name: string }>(a: T, b: T) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

    const savedByRequest = new Map<string, SavedResponse[]>();
    for (const sr of savedResponses) {
      const list = savedByRequest.get(sr.requestId) ?? [];
      list.push(sr);
      savedByRequest.set(sr.requestId, list);
    }
    for (const list of savedByRequest.values()) list.sort((a, b) => a.createdAt - b.createdAt);

    const requestSelfMatches = (r: ApiRequest) =>
      matches(r.name, query) ||
      matches(r.url, query) ||
      matches(r.description, query) ||
      r.tags.some((t) => matches(t, query));
    const savedMatches = (sr: SavedResponse) => matches(sr.name, query);
    const requestMatches = (r: ApiRequest) =>
      requestSelfMatches(r) || (savedByRequest.get(r.id) ?? []).some(savedMatches);

    /** request row plus its saved responses when expanded (search: only matching ones) */
    const pushRequest = (
      r: ApiRequest,
      depth: number,
      collectionId: string,
      parentFolderId: string | null,
    ) => {
      const saved = savedByRequest.get(r.id) ?? [];
      const matchingSaved = searching ? saved.filter(savedMatches) : saved;
      const isExpanded =
        saved.length > 0 && (expanded.has(r.id) || (searching && matchingSaved.length > 0));
      rows.push({
        kind: 'request',
        id: r.id,
        depth,
        name: r.name,
        request: r,
        savedCount: saved.length,
        expanded: isExpanded,
        collectionId,
        parentFolderId,
      });
      if (!isExpanded) return;
      const visible = searching && !requestSelfMatches(r) ? matchingSaved : saved;
      for (const sr of visible) {
        rows.push({
          kind: 'saved',
          id: sr.id,
          depth: depth + 1,
          name: sr.name,
          request: r,
          saved: sr,
          collectionId,
          parentFolderId,
        });
      }
    };

    /** returns true when the subtree contains a match (search mode) */
    const walkFolder = (collection: Collection, folder: FolderModel, depth: number): boolean => {
      const childFolders = (foldersByParent.get(`${collection.id}:${folder.id}`) ?? []).sort(
        bySort,
      );
      const childRequests = (requestsByParent.get(`${collection.id}:${folder.id}`) ?? []).sort(
        bySort,
      );
      const isExpanded = searching || expanded.has(folder.id);

      const marker = rows.length;
      rows.push({
        kind: 'folder',
        id: folder.id,
        depth,
        name: folder.name,
        expanded: isExpanded,
        collectionId: collection.id,
        parentFolderId: folder.parentId,
      });

      const hasMatch = !searching || matches(folder.name, query);
      let childHasMatch = false;
      if (isExpanded) {
        for (const cf of childFolders) {
          childHasMatch = walkFolder(collection, cf, depth + 1) || childHasMatch;
        }
        for (const r of childRequests) {
          if (searching && !requestMatches(r)) continue;
          childHasMatch = true;
          pushRequest(r, depth + 1, collection.id, folder.id);
        }
      }
      if (searching && !hasMatch && !childHasMatch) {
        rows.splice(marker, rows.length - marker); // prune non-matching subtree
        return false;
      }
      return hasMatch || childHasMatch;
    };

    for (const collection of Object.values(collections).sort(byName)) {
      const isExpanded = searching || expanded.has(collection.id);
      const marker = rows.length;
      rows.push({
        kind: 'collection',
        id: collection.id,
        depth: 0,
        name: collection.name,
        expanded: isExpanded,
        collectionId: collection.id,
        parentFolderId: null,
      });
      const hasMatch = !searching || matches(collection.name, query);
      let childHasMatch = false;
      if (isExpanded) {
        const rootFolders = (foldersByParent.get(`${collection.id}:`) ?? []).sort(bySort);
        const rootRequests = (requestsByParent.get(`${collection.id}:`) ?? []).sort(bySort);
        for (const f of rootFolders) {
          childHasMatch = walkFolder(collection, f, 1) || childHasMatch;
        }
        for (const r of rootRequests) {
          if (searching && !requestMatches(r)) continue;
          childHasMatch = true;
          pushRequest(r, 1, collection.id, null);
        }
      }
      if (searching && !hasMatch && !childHasMatch) {
        rows.splice(marker, rows.length - marker);
      }
    }
    return rows;
  }, [collections, folders, requests, savedResponses, expandedNodes, query]);
}

async function exportCollection(collectionId: string) {
  const { collections, folders, requests } = useData.getState();
  const collection = collections[collectionId];
  if (!collection) return;
  try {
    const json = await exportPostmanCollection(
      collection,
      Object.values(folders).filter((f) => f.collectionId === collectionId),
      Object.values(requests).filter((r) => r.collectionId === collectionId),
    );
    const saved = await downloadBlob(
      new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
      `${slugify(collection.name)}.postman_collection.json`,
    );
    if (saved) toast('success', 'Collection exported');
  } catch (err) {
    toast('error', 'Export failed', err instanceof Error ? err.message : String(err));
  }
}

const DND_TYPE = 'application/x-tree-node';

function ExpandToggle({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <span
      className="shrink-0 rounded p-0.5 hover:bg-accent"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {expanded ? (
        <ChevronDown className="size-3.5 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

function Row({
  row,
  renamingId,
  setRenamingId,
  isActive,
}: {
  row: TreeRow;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  isActive: boolean;
}) {
  const toggleExpanded = useUi((s) => s.toggleExpanded);
  const setExpanded = useUi((s) => s.setExpanded);
  const openRequest = useTabs((s) => s.openRequest);
  const openCollection = useTabs((s) => s.openCollection);
  const data = useData;
  const collections = useData((s) => s.collections);
  const [dragOver, setDragOver] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(row.name);

  const commitRename = () => {
    const name = renameValue.trim();
    if (name && name !== row.name) {
      if (row.kind === 'collection') data.getState().updateCollection(row.id, { name });
      if (row.kind === 'folder') data.getState().updateFolder(row.id, { name });
      if (row.kind === 'request') data.getState().updateRequest(row.id, { name });
      if (row.kind === 'saved') useSavedResponses.getState().rename(row.id, name);
    }
    setRenamingId(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    let payload: { kind: string; id: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData(DND_TYPE));
    } catch {
      return;
    }
    if (payload.id === row.id || row.kind === 'saved') return;
    const store = data.getState();
    if (payload.kind === 'request') {
      if (row.kind === 'request') {
        // insert before target within the same parent
        const target = row.request!;
        store.updateRequest(payload.id, {
          collectionId: row.collectionId,
          folderId: row.parentFolderId,
          sortOrder: target.sortOrder - 0.5,
        });
      } else {
        store.moveRequest(payload.id, row.collectionId, row.kind === 'folder' ? row.id : null);
        setExpanded(row.id, true);
      }
    } else if (payload.kind === 'folder') {
      const targetParent =
        row.kind === 'folder' ? row.id : row.kind === 'collection' ? null : row.parentFolderId;
      store.moveFolder(payload.id, row.collectionId, targetParent);
      if (row.kind !== 'request') setExpanded(row.id, true);
    }
  };

  const openMatchingTab = () => {
    if (row.kind === 'saved') {
      openRequest(row.request!.id);
      useUi.getState().focusSavedResponse(row.request!.id, row.id);
    } else if (row.kind === 'request') {
      openRequest(row.id);
    } else if (row.kind === 'collection') {
      // Postman-style: open the collection details tab (chevron handles collapse)
      setExpanded(row.id, true);
      openCollection(row.id);
    } else {
      toggleExpanded(row.id);
    }
  };

  const isRenaming = renamingId === row.id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!isRenaming && row.kind !== 'collection' && row.kind !== 'saved'}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: row.kind, id: row.id }));
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (row.kind !== 'saved' && e.dataTransfer.types.includes(DND_TYPE)) {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={openMatchingTab}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenameValue(row.name);
            setRenamingId(row.id);
          }}
          style={{ paddingLeft: 8 + row.depth * 14, height: ROW_HEIGHT }}
          className={cn(
            'flex cursor-default select-none items-center gap-1.5 pr-2 text-[13px]',
            'hover:bg-accent/60',
            isActive &&
              'bg-primary/10 font-medium before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary',
            'relative',
            dragOver && 'bg-primary/10 outline outline-1 -outline-offset-1 outline-primary/40',
          )}
        >
          {row.kind === 'collection' || row.kind === 'folder' ? (
            <>
              <ExpandToggle expanded={!!row.expanded} onToggle={() => toggleExpanded(row.id)} />
              <Folder
                className={cn(
                  'size-3.5 shrink-0',
                  row.kind === 'collection' ? 'text-primary' : 'text-muted-foreground',
                )}
              />
            </>
          ) : row.kind === 'request' ? (
            <>
              {row.savedCount ? (
                <ExpandToggle
                  expanded={!!row.expanded}
                  onToggle={() => toggleExpanded(row.id)}
                  label={`${row.savedCount} saved response${row.savedCount === 1 ? '' : 's'}`}
                />
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <span
                className={cn(
                  'w-9 shrink-0 text-right font-mono text-[9.5px] font-semibold',
                  requestBadge(row.request!).className,
                )}
              >
                {requestBadge(row.request!).label}
              </span>
            </>
          ) : (
            <>
              <span className="w-[18px] shrink-0" />
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
          {isRenaming ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-5 px-1 text-[13px]"
            />
          ) : (
            <span
              className={cn('min-w-0 flex-1 truncate', row.kind === 'collection' && 'font-medium')}
            >
              {row.name}
            </span>
          )}
          {row.kind === 'request' && row.request!.favorite && (
            <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
          )}
          {row.kind === 'saved' && !isRenaming && (
            <span
              className={cn(
                'shrink-0 font-mono text-[10px] font-semibold',
                statusColorClass(row.saved!.response.status),
              )}
            >
              {row.saved!.response.status || 'ERR'}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      {row.kind === 'saved' ? (
        <ContextMenuContent>
          <ContextMenuItem onSelect={openMatchingTab}>Open</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setRenameValue(row.name);
              setRenamingId(row.id);
            }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() =>
              confirmDelete(
                'saved response',
                row.name,
                () => useSavedResponses.getState().remove(row.id),
                { permanent: true },
              )
            }
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      ) : (
        <ContextMenuContent>
          {row.kind !== 'request' && (
            <>
              <ContextMenuItem
                onSelect={() =>
                  useUi
                    .getState()
                    .openRunner(row.collectionId, row.kind === 'folder' ? row.id : null)
                }
              >
                <Play /> Run {row.kind}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  const req = data
                    .getState()
                    .createRequest(row.collectionId, row.kind === 'folder' ? row.id : null);
                  if (req) {
                    setExpanded(row.id, true);
                    openRequest(req.id);
                  }
                }}
              >
                <FilePlus /> New request
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  data
                    .getState()
                    .createFolder(
                      row.collectionId,
                      row.kind === 'folder' ? row.id : null,
                      'New Folder',
                    );
                  setExpanded(row.id, true);
                }}
              >
                <FolderPlus /> New folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {row.kind === 'request' && (
            <>
              <ContextMenuItem onSelect={() => openRequest(row.id)}>Open</ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  data.getState().updateRequest(row.id, { favorite: !row.request!.favorite })
                }
              >
                {row.request!.favorite ? 'Remove favorite' : 'Favorite'}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void copyText(row.request!.url);
                }}
              >
                Copy URL
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void generateCurl(row.request!)
                    .then((code) => copyText(code))
                    .then(() => toast('success', 'Copied as cURL'))
                    .catch((err) =>
                      toast(
                        'error',
                        'Copy failed',
                        err instanceof Error ? err.message : String(err),
                      ),
                    );
                }}
              >
                Copy as cURL
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {Object.values(collections).map((c) => (
                    <ContextMenuItem
                      key={c.id}
                      disabled={c.id === row.collectionId && row.parentFolderId === null}
                      onSelect={() => data.getState().moveRequest(row.id, c.id, null)}
                    >
                      {c.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onSelect={() => {
              setRenameValue(row.name);
              setRenamingId(row.id);
            }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const store = data.getState();
              if (row.kind === 'collection') store.duplicateCollection(row.id);
              if (row.kind === 'folder') store.duplicateFolder(row.id);
              if (row.kind === 'request') store.duplicateRequest(row.id);
            }}
          >
            Duplicate
          </ContextMenuItem>
          {row.kind === 'collection' && (
            <ContextMenuItem onSelect={() => exportCollection(row.id)}>
              <Download /> Export (Postman v2.1)
            </ContextMenuItem>
          )}
          {row.kind === 'request' && (
            <ContextMenuItem
              onSelect={() => {
                const r = row.request!;
                downloadBlob(
                  new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
                  `${slugify(r.name)}.request.json`,
                );
              }}
            >
              <Download /> Export request
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              confirmDelete(row.kind, row.name, () => {
                const store = data.getState();
                if (row.kind === 'collection') store.deleteCollection(row.id);
                if (row.kind === 'folder') store.deleteFolder(row.id);
                if (row.kind === 'request') store.deleteRequest(row.id);
              });
            }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

export function CollectionsPanel() {
  const [query, setQuery] = React.useState('');
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const rows = useTreeRows(query);
  const hasCollections = useData((s) => Object.keys(s.collections).length > 0);
  const activeWorkspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const setDialog = useUi((s) => s.setDialog);
  const createCollection = useData((s) => s.createCollection);
  const setExpanded = useUi((s) => s.setExpanded);

  // Highlight the sidebar row for the request/collection open in the active tab.
  const activeTabId = useUi((s) => s.ui.activeTabId);
  const activeNodeId = useTabs((s) => {
    const tab = s.tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.draft) return null;
    return tab.requestId;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2 pb-1.5">
        <Input
          placeholder="Search collections"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" title="New…">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('http'))}>
              <FilePlus /> HTTP
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useTabs.getState().openDraft(protocolPreset('graphql'))}
            >
              <Braces /> GraphQL
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useTabs.getState().openDraft(protocolPreset('ws'))}>
              <Zap /> WebSocket
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useTabs.getState().openDraft(protocolPreset('socketio'))}
            >
              <Radio /> Socket.IO
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                const col = createCollection(activeWorkspaceId, 'New Collection');
                setExpanded(col.id, true);
                setRenamingId(col.id);
              }}
            >
              <FolderPlus /> Collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="iconSm" title="Import" onClick={() => setDialog('import')}>
          <Import />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          title="Export collections/environments"
          onClick={() => setDialog('export')}
        >
          <Download />
        </Button>
      </div>
      {hasCollections ? (
        rows.length > 0 ? (
          <VirtualList
            items={rows}
            rowHeight={ROW_HEIGHT}
            className="min-h-0 flex-1"
            renderRow={(row) => (
              <Row
                key={row.id}
                row={row}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                isActive={row.id === activeNodeId && row.kind !== 'folder'}
              />
            )}
          />
        ) : (
          <EmptyState title="No matches" />
        )
      ) : (
        <EmptyState icon={<Folder />} title="No collections yet">
          Create a collection or import a Postman file.
        </EmptyState>
      )}
    </div>
  );
}
