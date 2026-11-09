import { Bug, ExternalLink, Github, Package } from 'lucide-react';
import { openExternal } from '@/platform/system';
import { Button } from '@/components/ui/button';
import { Pane, Row } from './shared';
import { NEW_ISSUE_URL, RELEASES_URL, REPO_URL, useAppInfo } from './appMeta';

export function AboutPane() {
  const { info, error } = useAppInfo();

  return (
    <Pane title="About">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="size-12 rounded-xl" />
        <div>
          <div className="text-base font-semibold">Zorvilo</div>
          <div className="text-xs text-muted-foreground">
            A native desktop workspace for building, sending and testing API requests.
          </div>
        </div>
      </div>

      <Row label="Version">
        <span className="font-mono text-xs">{info?.version ?? '—'}</span>
      </Row>
      <Row label="Platform">
        <span className="font-mono text-xs">{info?.platform ?? '—'}</span>
      </Row>
      <Row label="Data directory">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={info?.dataDir}>
          {info?.dataDir ?? '—'}
        </span>
      </Row>
      {info && info.notes.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
          {info.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" size="sm" onClick={() => void openExternal(REPO_URL)}>
          <Github /> GitHub
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openExternal(RELEASES_URL)}>
          <Package /> Releases
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openExternal(NEW_ISSUE_URL)}>
          <Bug /> Report an issue
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void openExternal(`${REPO_URL}#readme`)}>
          <ExternalLink /> Documentation
        </Button>
      </div>
    </Pane>
  );
}
