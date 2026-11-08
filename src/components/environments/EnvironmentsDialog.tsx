import * as React from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useEnvironments } from '@/store/environments';
import { useUi, toast, confirmDelete } from '@/store/ui';
import { downloadBlob, slugify, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VariablesEditor } from './VariablesEditor';
import { exportPostmanEnvironment } from '@/features/exporter/postman';
import { importPostmanEnvironment } from '@/features/importer';
import { openTextFile } from '@/features/fs/fileAccess';

export function EnvironmentsDialog() {
  const open = useUi((s) => s.openDialog === 'environments');
  const setDialog = useUi((s) => s.setDialog);
  const activeWorkspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const environmentsTarget = useUi((s) => s.environmentsTarget);
  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);
  const {
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    setEnvironmentVariables,
    setGlobals,
    hydrate,
  } = useEnvironments();

  const [selectedId, setSelectedId] = React.useState<string>('globals');
  const selected = environments.find((e) => e.id === selectedId);

  React.useEffect(() => {
    if (open && environmentsTarget) setSelectedId(environmentsTarget);
  }, [open, environmentsTarget]);

  const importEnv = async () => {
    const file = await openTextFile();
    if (!file) return;
    try {
      const env = await importPostmanEnvironment(file.text, activeWorkspaceId);
      hydrate([...environments, env], globals);
      // persist through the store path
      useEnvironments.getState().updateEnvironment(env.id, {});
      setSelectedId(env.id);
      toast('success', `Imported "${env.name}"`);
    } catch (err) {
      toast('error', 'Import failed', err instanceof Error ? err.message : String(err));
    }
  };

  const exportEnv = async () => {
    if (!selected) return;
    try {
      const json = await exportPostmanEnvironment(selected);
      await downloadBlob(
        new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
        `${slugify(selected.name)}.postman_environment.json`,
      );
    } catch (err) {
      toast('error', 'Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="flex h-[70vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Environments & Variables</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3">
          {/* env list */}
          <div className="flex w-48 shrink-0 flex-col border-r pr-3">
            <button
              type="button"
              onClick={() => setSelectedId('globals')}
              className={cn(
                'rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent',
                selectedId === 'globals' && 'bg-accent font-medium',
              )}
            >
              Globals
              <span className="ml-1 text-[11px] text-muted-foreground">({globals.length})</span>
            </button>
            <div className="mt-1 border-t pt-1">
              {environments.map((env) => (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => setSelectedId(env.id)}
                  className={cn(
                    'flex w-full items-center rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent',
                    selectedId === env.id && 'bg-accent font-medium',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{env.name}</span>
                  {env.isActive && <span className="size-1.5 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="flex gap-1 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  const env = createEnvironment(activeWorkspaceId, 'New Environment');
                  setSelectedId(env.id);
                }}
              >
                <Plus /> New
              </Button>
              <Button variant="outline" size="sm" title="Import environment" onClick={() => void importEnv()}>
                <Upload />
              </Button>
            </div>
          </div>

          {/* editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedId === 'globals' ? (
              <>
                <p className="pb-2 text-xs text-muted-foreground">
                  Global variables apply across all workspaces (lowest precedence).
                </p>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <VariablesEditor variables={globals} onChange={setGlobals} />
                </div>
              </>
            ) : selected ? (
              <>
                <div className="flex items-center gap-2 pb-2">
                  <Input
                    value={selected.name}
                    onChange={(e) => updateEnvironment(selected.id, { name: e.target.value })}
                    className="max-w-56"
                  />
                  <Button variant="outline" size="sm" onClick={exportEnv}>
                    <Download /> Export
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      confirmDelete('environment', selected.name, () => {
                        deleteEnvironment(selected.id);
                        setSelectedId('globals');
                      })
                    }
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <VariablesEditor
                    variables={selected.variables}
                    onChange={(variables) => setEnvironmentVariables(selected.id, variables)}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select an environment
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
