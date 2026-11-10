import * as React from 'react';
import { Check, Copy, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces } from '@/store/workspaces';
import { useUi, toast, confirmDelete } from '@/store/ui';
import { downloadBlob, slugify } from '@/lib/utils';
import { exportWorkspaceBundle } from '@/features/exporter/postman';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { promptCreateWorkspace } from './createWorkspace';

export function WorkspacesDialog() {
  const open = useUi((s) => s.openDialog === 'workspaces');
  const setDialog = useUi((s) => s.setDialog);
  const activeId = useUi((s) => s.ui.activeWorkspaceId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const { rename, remove, duplicate, switchTo } = useWorkspaces();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  const exportWorkspace = async (id: string) => {
    const workspace = workspaces.find((w) => w.id === id);
    if (!workspace) return;
    try {
      const bundle = await exportWorkspaceBundle(id);
      const saved = await downloadBlob(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
        `${slugify(workspace.name)}.workspace.json`,
      );
      if (saved) toast('success', 'Workspace exported');
    } catch (err) {
      toast('error', 'Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Workspaces</DialogTitle>
          <DialogDescription>
            Each workspace has its own collections, environments, history and Git repo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto py-1">
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={cn(
                'group flex items-center gap-2 rounded-md px-2 py-1.5',
                w.id === activeId ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              {renamingId === w.id ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) rename(w.id, renameValue.trim());
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (renameValue.trim()) rename(w.id, renameValue.trim());
                      setRenamingId(null);
                    }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="h-6"
                />
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
                  onClick={() => void switchTo(w.id)}
                >
                  <Check className={cn('size-3.5 shrink-0', w.id !== activeId && 'invisible')} />
                  <span className="truncate">{w.name}</span>
                </button>
              )}
              <div className="hidden shrink-0 items-center group-hover:flex">
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Rename"
                  onClick={() => {
                    setRenameValue(w.name);
                    setRenamingId(w.id);
                  }}
                >
                  <Pencil />
                </Button>
                <Button variant="ghost" size="iconSm" title="Duplicate" onClick={() => void duplicate(w.id)}>
                  <Copy />
                </Button>
                <Button variant="ghost" size="iconSm" title="Export" onClick={() => void exportWorkspace(w.id)}>
                  <Download />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  title="Delete"
                  disabled={workspaces.length === 1}
                  onClick={() =>
                    confirmDelete('workspace', w.name, () => void remove(w.id), { permanent: true })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={() => void promptCreateWorkspace()}
        >
          <Plus /> New workspace
        </Button>
      </DialogContent>
    </Dialog>
  );
}
