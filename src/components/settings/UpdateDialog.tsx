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
  remindLater,
  shouldPrompt,
  skipVersion,
  type UpdateInfo,
} from './updates';

const STARTUP_CHECK_DELAY_MS = 3000;

/** Checks for a new release once at launch and prompts the user to update. */
export function UpdateDialog() {
  const [info, setInfo] = React.useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = React.useState(false);

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
      const path = await installUpdate(info.asset);
      clearUpdatePrompts();
      toast(
        'success',
        `Zorvilo ${info.latest} downloaded`,
        `The installer was opened (${path}). Quit Zorvilo and complete the installation to finish updating.`,
      );
      close();
    } catch (err) {
      toast('error', 'Update failed', err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !installing && onRemindLater()}>
      <DialogContent className="max-w-md" hideClose={installing}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            A new version of Zorvilo is available
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            {info.releaseName || `Zorvilo ${info.latest}`} is ready. You have {info.current}.
          </DialogDescription>
        </DialogHeader>
        {info.notes && (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 font-sans text-xs text-muted-foreground">
            {info.notes}
          </pre>
        )}
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void openExternal(info.releaseUrl)}
        >
          <ExternalLink className="size-3" /> View release page
        </button>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" size="sm" disabled={installing} onClick={onSkip}>
            Skip this version
          </Button>
          <Button variant="outline" size="sm" disabled={installing} onClick={onRemindLater}>
            Remind me later
          </Button>
          <Button size="sm" autoFocus disabled={installing} onClick={() => void onUpdate()}>
            <Download />
            {installing ? 'Downloading…' : 'Update now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
