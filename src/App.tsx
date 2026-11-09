import { useEffect } from 'react';
import { useUi } from '@/store/ui';
import { useGit } from '@/store/git';
import { useSettings } from '@/store/settings';
import { useApplyTheme } from '@/hooks/useTheme';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { initShareLinks } from '@/features/share/deepLink';
import { confirmNative } from '@/platform/system';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/misc';
import { CommandPalette } from '@/components/command/CommandPalette';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { UpdateDialog } from '@/components/settings/UpdateDialog';
import { GitDialog } from '@/components/git/GitDialog';
import { EnvironmentsDialog } from '@/components/environments/EnvironmentsDialog';
import { ImportDialog } from '@/components/importer/ImportDialog';
import { ExportDialog } from '@/components/exporter/ExportDialog';
import { WorkspacesDialog } from '@/components/workspaces/WorkspacesDialog';
import { SaveRequestDialog } from '@/components/request/SaveRequestDialog';
import { CloseTabDialog } from '@/components/tabs/CloseTabDialog';
import { RunnerDialog } from '@/components/runner/RunnerDialog';
import { ChoiceDialog, ConfirmDialog, TextPromptDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { resetDatabase } from '@/db/database';

function BootError({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-lg font-semibold">Failed to open local storage</div>
      <p className="max-w-md text-sm text-muted-foreground">
        {message} — the local database file may be corrupt or locked by another Zorvilo
        window. Resetting moves the old file aside (it is not deleted) and starts fresh.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            void confirmNative(
              'Reset database',
              'Start with a fresh database? The current file is moved aside, not deleted.',
              'Reset',
            ).then((ok) => {
              if (ok) void resetDatabase();
            });
          }}
        >
          Reset database
        </Button>
      </div>
    </div>
  );
}

export default function App() {
  const ready = useUi((s) => s.ready);
  const bootError = useUi((s) => s.bootError);
  useApplyTheme();
  useKeyboardShortcuts();

  // Optional background git auto-sync — never blocks the UI.
  const autoSyncEnabled = useSettings((s) => s.settings.autoSyncEnabled);
  const autoSyncIntervalMin = useSettings((s) => s.settings.autoSyncIntervalMin);
  useEffect(() => {
    if (!ready || !autoSyncEnabled) return;
    void useGit.getState().backgroundSync();
    const interval = setInterval(
      () => void useGit.getState().backgroundSync(),
      Math.max(5, autoSyncIntervalMin) * 60_000,
    );
    return () => clearInterval(interval);
  }, [ready, autoSyncEnabled, autoSyncIntervalMin]);

  // Open shared requests from `zorvilo://request/…` links (at launch and while running).
  useEffect(() => {
    if (!ready) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void initShareLinks().then((d) => {
      if (cancelled) d();
      else dispose = d;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [ready]);

  if (bootError) return <BootError message={bootError} />;
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <TooltipProvider>
      <AppShell />
      <CommandPalette />
      <SettingsDialog />
      <GitDialog />
      <EnvironmentsDialog />
      <ImportDialog />
      <ExportDialog />
      <WorkspacesDialog />
      <SaveRequestDialog />
      <CloseTabDialog />
      <RunnerDialog />
      <ConfirmDialog />
      <ChoiceDialog />
      <TextPromptDialog />
      <UpdateDialog />
      <Toaster />
    </TooltipProvider>
  );
}
