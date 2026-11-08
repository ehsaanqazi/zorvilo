import * as React from 'react';
import { Download, Folder, Layers } from 'lucide-react';
import { useUi, toast } from '@/store/ui';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { slugify } from '@/lib/utils';
import {
  exportPostmanCollection,
  exportPostmanEnvironment,
  saveJsonFiles,
} from '@/features/exporter/postman';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Multi-select export: each selection downloads as its own JSON file. */
export function ExportDialog() {
  const open = useUi((s) => s.openDialog === 'export');
  const setDialog = useUi((s) => s.setDialog);
  const collections = useData((s) => s.collections);
  const folders = useData((s) => s.folders);
  const requests = useData((s) => s.requests);
  const environments = useEnvironments((s) => s.environments);

  const [selectedCols, setSelectedCols] = React.useState<Set<string>>(new Set());
  const [selectedEnvs, setSelectedEnvs] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (open) {
      setSelectedCols(new Set());
      setSelectedEnvs(new Set());
    }
  }, [open]);

  const collectionList = Object.values(collections).sort((a, b) => a.name.localeCompare(b.name));
  const total = selectedCols.size + selectedEnvs.size;

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const doExport = async () => {
    try {
      const files: { name: string; data: unknown }[] = [];
      for (const id of selectedCols) {
        const collection = collections[id];
        if (!collection) continue;
        files.push({
          name: `${slugify(collection.name)}.postman_collection.json`,
          data: await exportPostmanCollection(
            collection,
            Object.values(folders).filter((f) => f.collectionId === id),
            Object.values(requests).filter((r) => r.collectionId === id),
          ),
        });
      }
      for (const id of selectedEnvs) {
        const env = environments.find((e) => e.id === id);
        if (!env) continue;
        files.push({
          name: `${slugify(env.name)}.postman_environment.json`,
          data: await exportPostmanEnvironment(env),
        });
      }
      // one file → Save dialog; several → choose a folder
      if (!(await saveJsonFiles(files))) return;
      toast('success', `Exported ${files.length} file(s)`, 'Each item was saved as a separate JSON file.');
      setDialog(null);
    } catch (err) {
      toast('error', 'Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="flex max-h-[75vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Select collections and environments — each is saved as a separate Postman JSON file.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Collections ({collectionList.length})
              </span>
              <div className="flex gap-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 px-0"
                  onClick={() => setSelectedCols(new Set(collectionList.map((c) => c.id)))}
                >
                  Select all
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 px-0"
                  onClick={() => setSelectedCols(new Set())}
                >
                  None
                </Button>
              </div>
            </div>
            <div className="rounded border">
              {collectionList.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 text-[13px] last:border-b-0 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={selectedCols.has(c.id)}
                    onCheckedChange={() => toggle(selectedCols, c.id, setSelectedCols)}
                  />
                  <Folder className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate">{c.name}</span>
                </label>
              ))}
              {collectionList.length === 0 && (
                <div className="p-3 text-center text-xs text-muted-foreground">No collections</div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Environments ({environments.length})
              </span>
              <div className="flex gap-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 px-0"
                  onClick={() => setSelectedEnvs(new Set(environments.map((e) => e.id)))}
                >
                  Select all
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 px-0"
                  onClick={() => setSelectedEnvs(new Set())}
                >
                  None
                </Button>
              </div>
            </div>
            <div className="rounded border">
              {environments.map((env) => (
                <label
                  key={env.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 text-[13px] last:border-b-0 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={selectedEnvs.has(env.id)}
                    onCheckedChange={() => toggle(selectedEnvs, env.id, setSelectedEnvs)}
                  />
                  <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{env.name}</span>
                </label>
              ))}
              {environments.length === 0 && (
                <div className="p-3 text-center text-xs text-muted-foreground">No environments</div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button disabled={total === 0} onClick={() => void doExport()}>
            <Download /> Export {total > 0 ? `${total} file(s)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
