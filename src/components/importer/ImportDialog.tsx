import * as React from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import { useUi, toast, askChoice } from '@/store/ui';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { loadWorkspaceData } from '@/db/bootstrap';
import { parseImport } from '@/features/importer';
import { useTabs } from '@/store/tabs';
import { openTextFiles } from '@/features/fs/fileAccess';
import { flushPending, queuePut } from '@/db/persistence';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A same-named collection/environment already exists — ask what to do.
 * Resolves 'replace' | 'keep' | null (cancel/dismissed).
 */
function askDuplicate(kind: 'collection' | 'environment', name: string) {
  return askChoice(
    `${kind === 'collection' ? 'Collection' : 'Environment'} already exists`,
    `A ${kind} named "${name}" already exists in this workspace. Replace it with the imported one, keep both, or cancel the import?`,
    [
      { label: 'Keep both', value: 'keep', variant: 'outline' },
      { label: 'Replace', value: 'replace', variant: 'destructive' },
    ],
  ) as Promise<'replace' | 'keep' | null>;
}

/** Returns the toast message, or null when the user cancelled the import. */
async function runImport(text: string, workspaceId: string): Promise<string | null> {
  // detection + parsing happen in the Rust backend
  const parsed = await parseImport(text, workspaceId);

  // cURL command → open as a new request
  if (parsed.kind === 'curl') {
    const r = parsed.request;
    useTabs.getState().openDraft({
      method: r.method,
      url: r.url,
      params: r.params,
      pathParams: r.pathParams,
      headers: r.headers,
      cookies: r.cookies,
      auth: r.auth,
      body: r.body,
      name: parsed.suggestedName,
    });
    return `Imported cURL request for ${parsed.suggestedName} — opened in a new tab.`;
  }

  if (parsed.kind === 'postman-collection') {
    const { collection, folders, requests } = parsed;
    let data = useData.getState();
    const duplicates = Object.values(data.collections).filter(
      (c) => c.workspaceId === workspaceId && sameName(c.name, collection.name),
    );
    if (duplicates.length > 0) {
      const choice = await askDuplicate('collection', collection.name);
      if (!choice) return null;
      if (choice === 'replace') {
        duplicates.forEach((c) => data.deleteCollection(c.id));
        data = useData.getState();
      }
    }
    data.hydrate({
      collections: [...Object.values(data.collections), collection],
      folders: [...Object.values(data.folders), ...folders],
      requests: [...Object.values(data.requests), ...requests],
    });
    queuePut('collections', collection);
    folders.forEach((f) => queuePut('folders', f));
    requests.forEach((r) => queuePut('requests', r));
    const warn = parsed.warnings.length ? ` ${parsed.warnings.length} warning(s).` : '';
    return `Imported collection "${collection.name}" (${requests.length} requests, Postman v${parsed.version}).${warn}`;
  }

  if (parsed.kind === 'postman-environment') {
    const env = parsed.environment;
    let envs = useEnvironments.getState();
    const duplicates = envs.environments.filter(
      (e) => e.workspaceId === workspaceId && sameName(e.name, env.name),
    );
    if (duplicates.length > 0) {
      const choice = await askDuplicate('environment', env.name);
      if (!choice) return null;
      if (choice === 'replace') {
        duplicates.forEach((e) => envs.deleteEnvironment(e.id));
        envs = useEnvironments.getState();
      }
    }
    envs.hydrate([...envs.environments, env], envs.globals);
    queuePut('environments', env);
    return `Imported environment "${env.name}" (${env.variables.length} variables).`;
  }

  // workspace bundle (original ids kept: re-importing replaces)
  parsed.collections.forEach((c) => queuePut('collections', c));
  parsed.folders.forEach((f) => queuePut('folders', f));
  parsed.requests.forEach((r) => queuePut('requests', r));
  parsed.environments.forEach((e) => queuePut('environments', e));
  await flushPending();
  await loadWorkspaceData(workspaceId);
  const failed = parsed.failed.length ? ` ${parsed.failed.length} record(s) could not be read.` : '';
  return `Imported workspace bundle (${parsed.collections.length} collections).${failed}`;
}

export function ImportDialog() {
  const open = useUi((s) => s.openDialog === 'import');
  const setDialog = useUi((s) => s.setDialog);
  const workspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const doImport = async (content: string) => {
    setBusy(true);
    try {
      const message = await runImport(content, workspaceId);
      if (message === null) {
        toast('info', 'Import cancelled');
        return;
      }
      toast('success', 'Import complete', message);
      setDialog(null);
      setText('');
    } catch (err) {
      toast('error', 'Import failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doImportFiles = async () => {
    const files = await openTextFiles('.json');
    if (files.length === 0) return;
    setBusy(true);
    let ok = 0;
    let cancelled = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const message = await runImport(file.text, workspaceId);
        if (message === null) cancelled++;
        else ok++;
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast('success', `Imported ${ok} file(s)`, errors.length ? `${errors.length} failed.` : undefined);
      setDialog(null);
      setText('');
    }
    if (cancelled > 0) {
      toast('info', `Skipped ${cancelled} import(s)`, 'Cancelled because of name conflicts.');
    }
    if (errors.length > 0) {
      toast('error', 'Some imports failed', errors.slice(0, 3).join('\n'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Postman Collection v2.0 / v2.1, Postman Environment, workspace bundle, or a cURL
            command.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button variant="outline" disabled={busy} onClick={() => void doImportFiles()}>
            <FolderOpen /> Choose JSON file(s) — multiple collections/environments at once
          </Button>
          <div className="text-center text-[11px] text-muted-foreground">
            or paste JSON / cURL
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d \'{"name":"Jane"}\'\n\n…or a Postman collection/environment JSON'}
            className="h-40 font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button disabled={!text.trim() || busy} onClick={() => void doImport(text)}>
            <FileUp /> {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
