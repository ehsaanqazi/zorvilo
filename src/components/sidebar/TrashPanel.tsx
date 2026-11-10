import * as React from 'react';
import { ArchiveRestore, Folder, FileText, Layers, Trash2 } from 'lucide-react';
import type { TrashEntry } from '@/types/models';
import { useUi, confirmDelete } from '@/store/ui';
import {
  deleteTrashEntry,
  emptyTrash,
  listTrash,
  purgeExpiredTrash,
  restoreTrashEntry,
} from '@/features/trash/trash';
import { formatTimestamp } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';

const KIND_ICON = {
  collection: Folder,
  folder: Folder,
  request: FileText,
  environment: Layers,
} as const;

export function TrashPanel() {
  const workspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const [entries, setEntries] = React.useState<TrashEntry[]>([]);

  const refresh = React.useCallback(async () => {
    await purgeExpiredTrash();
    setEntries(await listTrash(workspaceId));
  }, [workspaceId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between px-2">
        <span className="px-1 text-xs font-semibold text-foreground">Trash</span>
        <Button
          variant="ghost"
          size="iconSm"
          title="Empty trash"
          disabled={entries.length === 0}
          onClick={() =>
            confirmDelete(
              'trash contents',
              `${entries.length} item(s)`,
              () => void emptyTrash(workspaceId).then(refresh),
              { permanent: true },
            )
          }
        >
          <Trash2 />
        </Button>
      </div>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">
        Deleted items are kept for 30 days, then removed permanently.
      </p>
      {entries.length === 0 ? (
        <EmptyState icon={<Trash2 />} title="Trash is empty" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => {
            const Icon = KIND_ICON[entry.kind];
            return (
              <div
                key={entry.id}
                className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{entry.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {entry.kind} · deleted {formatTimestamp(entry.deletedAt)}
                  </div>
                </div>
                <div className="hidden shrink-0 items-center group-hover:flex">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    title="Restore"
                    onClick={() => void restoreTrashEntry(entry).then(refresh)}
                  >
                    <ArchiveRestore />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    title="Delete forever"
                    onClick={() =>
                      confirmDelete(
                        entry.kind,
                        entry.name,
                        () => void deleteTrashEntry(entry.id).then(refresh),
                        { permanent: true },
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
