import * as React from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { openExternal } from '@/platform/system';
import { toast } from '@/store/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pane, Row } from './shared';
import { RELEASES_URL, UPDATE_REPO, useAppInfo } from './appMeta';
import { checkForUpdate, clearUpdatePrompts, installUpdate, type UpdateInfo } from './updates';

/** Check GitHub Releases for a newer version and install it. */
export function UpdatesPane() {
  const repo = UPDATE_REPO;
  const { info: app } = useAppInfo();
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [info, setInfo] = React.useState<UpdateInfo | null>(null);

  const check = async () => {
    setChecking(true);
    setInfo(null);
    try {
      const result = await checkForUpdate();
      setInfo(result);
      if (!result.updateAvailable)
        toast('success', `You're on the latest version (${result.current})`);
    } catch (err) {
      toast('error', 'Update check failed', err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    if (!info?.asset) return;
    setInstalling(true);
    try {
      const path = await installUpdate(info.asset);
      clearUpdatePrompts();
      toast(
        'success',
        `Zorvilo ${info.latest} downloaded`,
        `The installer was opened (${path}). Quit Zorvilo and complete the installation to finish updating.`,
      );
    } catch (err) {
      toast('error', 'Update failed', err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Pane title="Updates" description="Get the latest version of Zorvilo from GitHub Releases.">
      <Row label="Installed version">
        <span className="font-mono text-xs">{app?.version ?? '—'}</span>
      </Row>
      <Row
        label="Release repository"
        hint="GitHub repository that publishes Zorvilo releases (owner/repo)"
      >
        <Input
          value={repo}
          readOnly
          aria-readonly="true"
          tabIndex={-1}
          className="flex-1 cursor-default font-mono text-xs text-muted-foreground focus-visible:ring-0"
        />
      </Row>
      <Row label="Check for updates" hint="Download and install the latest version">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={checking || installing}
            onClick={() => void check()}
          >
            <RefreshCw className={checking ? 'animate-spin' : undefined} />
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openExternal(RELEASES_URL)}>
            <ExternalLink /> All releases
          </Button>
        </div>
      </Row>
      {info?.updateAvailable && (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-xs">
          <div>
            <span className="font-medium">{info.releaseName}</span>{' '}
            <span className="text-muted-foreground">
              (installed {info.current} → latest {info.latest})
            </span>
          </div>
          {info.notes && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-muted-foreground">
              {info.notes}
            </pre>
          )}
          <div className="flex gap-2">
            {info.asset ? (
              <Button size="sm" disabled={installing} onClick={() => void install()}>
                <Download /> {installing ? 'Downloading…' : `Download & install ${info.latest}`}
              </Button>
            ) : (
              <span className="self-center text-muted-foreground">
                No installer for this platform in the release.
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void openExternal(info.releaseUrl)}>
              <ExternalLink /> Release page
            </Button>
          </div>
        </div>
      )}
    </Pane>
  );
}
