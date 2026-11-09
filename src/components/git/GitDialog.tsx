import * as React from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { useGit } from '@/store/git';
import { useUi } from '@/store/ui';
import { formatTimestamp } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="flex-1 font-mono text-xs"
      />
    </label>
  );
}

export function GitDialog() {
  const open = useUi((s) => s.openDialog === 'git');
  const setDialog = useUi((s) => s.setDialog);
  const { meta, status, branches, busy, hasRepo } = useGit();
  const git = useGit.getState();
  const [commitMessage, setCommitMessage] = React.useState('');
  const [setupTab, setSetupTab] = React.useState<'clone' | 'open'>('clone');

  React.useEffect(() => {
    if (open) {
      git.ensureMeta();
      void git.refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const m = meta;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="size-4" /> Git synchronization
          </DialogTitle>
          <DialogDescription>
            One repository is shared by ALL workspaces — each workspace syncs into its own folder
            (workspaces/&lt;name&gt;/…), so collections and environments always land back in the
            right workspace.
          </DialogDescription>
        </DialogHeader>

        {m && (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto py-1 pr-1">
            {!hasRepo && (
              <div className="flex gap-1 border-b">
                {(
                  [
                    ['clone', 'Clone repository'],
                    ['open', 'Open existing repository'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSetupTab(key)}
                    className={
                      '-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ' +
                      (setupTab === key
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {!hasRepo && setupTab === 'open' ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Choose a Git repository folder that is already on this computer. Its collections
                  and environments are imported, and commits, pulls and pushes run directly in that
                  folder.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!!busy} onClick={() => void git.openLocal()}>
                    <FolderOpen /> Choose repository folder…
                  </Button>
                  {busy && <span className="self-center text-xs text-muted-foreground">{busy}…</span>}
                </div>
              </div>
            ) : (
              <>
            <div className="flex flex-col gap-2">
              {hasRepo && m.dir && <Field label="Local folder" value={m.dir} disabled />}
              <Field
                label="Repository URL"
                value={m.repoUrl}
                onChange={(repoUrl) => git.updateMeta({ repoUrl })}
                placeholder="https://github.com/<owner>/<repo>.git"
              />
              <Field
                label="Username"
                value={m.username}
                onChange={(username) => git.updateMeta({ username })}
                placeholder="username (optional for token auth)"
              />
              <Field
                label="Token"
                type="password"
                value={m.token}
                onChange={(token) => git.updateMeta({ token })}
                placeholder="personal access token (stored in the OS keychain)"
              />
              {!hasRepo && (
                <Field
                  label="Branch"
                  value={m.branch}
                  onChange={(branch) => git.updateMeta({ branch })}
                  placeholder="main"
                />
              )}
              <Field label="Author name" value={m.authorName} onChange={(authorName) => git.updateMeta({ authorName })} placeholder="optional" />
              <Field label="Author email" value={m.authorEmail} onChange={(authorEmail) => git.updateMeta({ authorEmail })} placeholder="optional" />
            </div>

            <div className="flex flex-wrap gap-2">
              {!hasRepo ? (
                <>
                  <Button disabled={!!busy || !m.repoUrl} onClick={() => void git.clone()}>
                    <ArrowDownToLine /> Clone repository
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => void git.init()}>
                    Initialize new repo
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" disabled={!!busy} onClick={() => void git.pullNow()}>
                    <ArrowDownToLine /> Pull
                  </Button>
                  <Button variant="outline" disabled={!!busy || !m.repoUrl} onClick={() => void git.pushNow()}>
                    <ArrowUpFromLine /> Push
                  </Button>
                  <Button disabled={!!busy} onClick={() => void git.syncNow()}>
                    <RefreshCw /> Sync now
                  </Button>
                </>
              )}
              {busy && <span className="self-center text-xs text-muted-foreground">{busy}…</span>}
            </div>
              </>
            )}

            {hasRepo && (
              <>
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <Select
                    value={status?.branch ?? m.branch}
                    onValueChange={(b) => void git.switchBranch(b)}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {(branches.length ? branches : [m.branch]).map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.lastSyncAt > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      Last sync {formatTimestamp(m.lastSyncAt)}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium">
                    Changes{' '}
                    <span className="text-muted-foreground">
                      ({status?.changedFiles.length ?? 0} file(s))
                    </span>
                  </div>
                  {status && status.changedFiles.length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded border p-2 font-mono text-[11px]">
                      {status.changedFiles.map((f) => (
                        <div key={f.path} className="flex gap-2">
                          <span
                            className={
                              f.status === 'added'
                                ? 'text-emerald-500'
                                : f.status === 'deleted'
                                  ? 'text-red-500'
                                  : 'text-amber-500'
                            }
                          >
                            {f.status[0]!.toUpperCase()}
                          </span>
                          <span className="truncate">{f.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => {
                        void git.commit(commitMessage).then(() => setCommitMessage(''));
                      }}
                    >
                      <GitCommitHorizontal /> Commit
                    </Button>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={!!busy || !status || status.changedFiles.length === 0}
                      onClick={() =>
                        useUi.getState().requestConfirm({
                          title: 'Discard all changes?',
                          message: `All ${status?.changedFiles.length ?? 0} uncommitted change(s) will be thrown away and your collections and environments go back to the last commit. This cannot be undone.`,
                          confirmLabel: 'Discard all changes',
                          onConfirm: () => void git.discardChanges(),
                        })
                      }
                    >
                      <Undo2 /> Discard all changes
                    </Button>
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Git runs natively (libgit2) against a working tree in Zorvilo&apos;s data folder, or in
              the repository folder you opened. Secret
              variable values never leave this machine, and the token is kept in the OS keychain.
              Conflicting pulls are detected and reported — your local commit is kept until you
              resolve it or use &quot;Pull latest&quot; to take the remote version.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
