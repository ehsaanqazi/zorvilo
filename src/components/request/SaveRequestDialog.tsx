import * as React from 'react';
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderPlus } from 'lucide-react';
import type { Folder } from '@/types/models';
import { useUi } from '@/store/ui';
import { useData } from '@/store/data';
import { useTabs } from '@/store/tabs';
import { getTabRequest, updateTabRequest } from '@/features/http/execute';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "Save draft to collection" — Postman-style destination picker:
 * pick a collection, drill into its folders, click a folder to open + select it.
 */
export function SaveRequestDialog() {
  const open = useUi((s) => s.openDialog === 'saveRequest');
  const tabId = useUi((s) => s.saveRequestTabId);
  const setDialog = useUi((s) => s.setDialog);
  const collections = useData((s) => s.collections);
  const folders = useData((s) => s.folders);
  const createCollection = useData((s) => s.createCollection);
  const saveDraftTo = useTabs((s) => s.saveDraftTo);
  const activeWorkspaceId = useUi((s) => s.ui.activeWorkspaceId);

  const request = tabId ? getTabRequest(tabId) : null;
  const [name, setName] = React.useState('');
  const [collectionId, setCollectionId] = React.useState<string | null>(null);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (open && request) {
      setName(request.name);
      setCollectionId(Object.values(collections)[0]?.id ?? null);
      setFolderId(null);
      setExpandedFolders(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !tabId || !request) return null;

  const collectionList = Object.values(collections).sort((a, b) => a.name.localeCompare(b.name));

  const childFolders = (colId: string, parentId: string | null): Folder[] =>
    Object.values(folders)
      .filter((f) => f.collectionId === colId && f.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const pickFolder = (folder: Folder) => {
    setCollectionId(folder.collectionId);
    setFolderId(folder.id);
    // clicking a folder also opens it, like Postman
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder.id)) next.delete(folder.id);
      else next.add(folder.id);
      return next;
    });
  };

  const renderFolders = (colId: string, parentId: string | null, depth: number): React.ReactNode =>
    childFolders(colId, parentId).map((folder) => {
      const children = childFolders(colId, folder.id);
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = folderId === folder.id;
      return (
        <React.Fragment key={folder.id}>
          <button
            type="button"
            onClick={() => pickFolder(folder)}
            style={{ paddingLeft: 12 + depth * 16 }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent',
              isSelected && 'bg-accent font-medium',
            )}
          >
            {children.length > 0 ? (
              isExpanded ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{folder.name}</span>
          </button>
          {isExpanded && renderFolders(colId, folder.id, depth + 1)}
        </React.Fragment>
      );
    });

  const save = () => {
    if (!collectionId) return;
    updateTabRequest(tabId, { name: name.trim() || 'Untitled Request' });
    saveDraftTo(tabId, collectionId, folderId);
    setDialog(null);
    const ui = useUi.getState();
    if (ui.saveRequestCloseAfter) {
      ui.setSaveRequestCloseAfter(false);
      useTabs.getState().close(tabId);
    }
  };

  const cancel = () => {
    useUi.getState().setSaveRequestCloseAfter(false);
    setDialog(null);
  };

  const selectedCollection = collectionId ? collections[collectionId] : undefined;
  const selectedFolder = folderId ? folders[folderId] : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="flex max-h-[75vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Save request</DialogTitle>
          <DialogDescription>
            Pick a collection, then optionally drill into a folder.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Request name" autoFocus />
          <div className="min-h-0 flex-1 overflow-y-auto rounded border p-1">
            {collectionList.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No collections yet — create one below.
              </div>
            )}
            {collectionList.map((col) => {
              const isCurrent = collectionId === col.id;
              return (
                <React.Fragment key={col.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCollectionId(col.id);
                      setFolderId(null); // collection root
                    }}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                      isCurrent && folderId === null && 'bg-accent font-medium',
                    )}
                  >
                    <FolderIcon className="size-4 shrink-0 text-primary" />
                    <span className="truncate">{col.name}</span>
                  </button>
                  {isCurrent && renderFolders(col.id, null, 1)}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {selectedCollection
                ? `Saving to: ${selectedCollection.name}${selectedFolder ? ` / ${selectedFolder.name}` : ''}`
                : 'Select a destination'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const col = createCollection(activeWorkspaceId, 'New Collection');
                setCollectionId(col.id);
                setFolderId(null);
              }}
            >
              <FolderPlus /> New collection
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!collectionId}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
