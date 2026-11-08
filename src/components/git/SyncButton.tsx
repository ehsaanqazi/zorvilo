import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useGit } from '@/store/git';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const POLL_INTERVAL_MS = 60_000;

/**
 * Header sync button. Polls the remote (git fetch, no working-tree changes)
 * and shows how many commits are waiting as "Sync n". Clicking discards ALL
 * local changes and pulls the latest remote state automatically.
 */
export function SyncButton() {
  const behind = useGit((s) => s.behind);
  const busy = useGit((s) => s.busy);
  const hasRepo = useGit((s) => s.hasRepo);
  const repoUrl = useGit((s) => s.meta?.repoUrl ?? '');
  const setDialog = useUi((s) => s.setDialog);

  React.useEffect(() => {
    // checkRemote no-ops instantly when no remote is configured
    const check = () => void useGit.getState().checkRemote();
    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const configured = hasRepo && !!repoUrl;
  const hasChanges = behind > 0;

  return (
    <Button
      variant={hasChanges ? 'default' : 'ghost'}
      size="sm"
      title={
        !configured
          ? 'Set up Git sync'
          : hasChanges
            ? `${behind} new change(s) on the remote — click to discard local changes and pull`
            : 'Discard local changes and pull the latest from the remote'
      }
      onClick={() => {
        if (!configured) {
          setDialog('git');
        } else {
          void useGit.getState().pullLatest();
        }
      }}
      className={cn(!hasChanges && 'text-muted-foreground')}
    >
      <RefreshCw className={cn(busy && 'animate-spin')} />
      Sync
      {hasChanges && (
        <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[11px] font-semibold leading-4">
          {behind}
        </span>
      )}
    </Button>
  );
}
