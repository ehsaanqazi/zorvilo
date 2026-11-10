import * as React from 'react';
import { Download, ExternalLink, Sparkles } from 'lucide-react';
import { openExternal } from '@/platform/system';
import { toast } from '@/store/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  checkForUpdate,
  clearUpdatePrompts,
  installUpdate,
  installedMessage,
  remindLater,
  shouldPrompt,
  skipVersion,
  type UpdateInfo,
} from './updates';
import { UpdateProgressBar, useUpdateProgress } from './UpdateProgress';

const STARTUP_CHECK_DELAY_MS = 3000;

/** Checks for a new release once at launch and prompts the user to update. */
export function UpdateDialog() {
  const [info, setInfo] = React.useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const progress = useUpdateProgress(installing);

  React.useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      checkForUpdate().then(
        (result) => {
          if (!cancelled && shouldPrompt(result)) setInfo(result);
        },
        () => {
          // Offline or rate-limited — stay quiet; the Updates pane reports errors.
        },
      );
    }, STARTUP_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!info) return null;

  const close = () => setInfo(null);

  const onRemindLater = () => {
    remindLater();
    close();
  };

  const onSkip = () => {
    skipVersion(info.latest);
    close();
  };

  const onUpdate = async () => {
    if (!info.asset) {
      void openExternal(info.releaseUrl);
      close();
      return;
    }
    setInstalling(true);
    try {
      const outcome = await installUpdate(info.asset);
      clearUpdatePrompts();
      if (outcome.restarting) {
        // Keep the progress visible until the app quits and relaunches.
        setRestarting(true);
        return;
      }
      const [title, detail] = installedMessage(info.latest, outcome);
      toast('success', title, detail);
      setInstalling(false);
      close();
    } catch (err) {
      toast('error', 'Update failed', err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !installing && onRemindLater()}>
      <DialogContent className="max-w-md" hideClose={installing}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {installing ? `Updating to Zorvilo ${info.latest}` : 'A new version of Zorvilo is available'}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            {installing
              ? 'Downloading the update. Zorvilo will restart automatically when it is ready.'
              : `Update to Zorvilo ${info.latest} to get the latest features and fixes. You have ${info.current}.`}
          </DialogDescription>
        </DialogHeader>
        {installing ? (
          <UpdateProgressBar
            progress={progress}
            fallbackTotal={info.asset?.size}
            restarting={restarting}
          />
        ) : (
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void openExternal(info.releaseUrl)}
          >
            <ExternalLink className="size-3" /> View release page
          </button>
        )}
        {!installing && (
          <DialogFooter className="flex-wrap">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip this version
            </Button>
            <Button variant="outline" size="sm" onClick={onRemindLater}>
              Remind me later
            </Button>
            <Button size="sm" autoFocus onClick={() => void onUpdate()}>
              <Download />
              Update now
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
