import * as React from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { useSettings } from '@/store/settings';
import { useUi, toast } from '@/store/ui';
import { wipeAllData } from '@/db/database';
import type { ThemeMode } from '@/types/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { KeyValueEditor } from '@/components/request/KeyValueEditor';
import { Pane, Row, SubHeading } from './shared';

function useSettingsState() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return { settings, update };
}

export function AppearancePane() {
  const { settings, update } = useSettingsState();
  return (
    <Pane title="Theme" description="Colors and interface sizing.">
      <Row label="Theme">
        <Select
          value={settings.theme}
          onValueChange={(theme) => update({ theme: theme as ThemeMode })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="dark-slate">Dark (Slate)</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="UI font size">
        <Input
          type="number"
          min={10}
          max={20}
          value={settings.fontSize}
          onChange={(e) =>
            update({ fontSize: Math.min(20, Math.max(10, Number(e.target.value) || 13)) })
          }
          className="w-24"
        />
      </Row>
    </Pane>
  );
}

export function EditorPane() {
  const { settings, update } = useSettingsState();
  return (
    <Pane title="Editor" description="Code and body editor preferences.">
      <Row label="Editor font size">
        <Input
          type="number"
          min={10}
          max={24}
          value={settings.editorFontSize}
          onChange={(e) =>
            update({ editorFontSize: Math.min(24, Math.max(10, Number(e.target.value) || 13)) })
          }
          className="w-24"
        />
      </Row>
      <Row label="Word wrap in editors">
        <Switch checked={settings.wordWrap} onCheckedChange={(wordWrap) => update({ wordWrap })} />
      </Row>
      <Row label="JSON indent" hint="Spaces used by pretty-printing">
        <Input
          type="number"
          min={0}
          max={8}
          value={settings.jsonIndent}
          onChange={(e) =>
            update({ jsonIndent: Math.min(8, Math.max(0, Number(e.target.value) || 2)) })
          }
          className="w-24"
        />
      </Row>
    </Pane>
  );
}

export function RequestsPane() {
  const { settings, update } = useSettingsState();
  return (
    <Pane title="Requests" description="Defaults applied when sending and managing requests.">
      <Row label="Default timeout (ms)">
        <Input
          type="number"
          min={1000}
          value={settings.requestTimeoutMs}
          onChange={(e) =>
            update({ requestTimeoutMs: Math.max(1000, Number(e.target.value) || 30000) })
          }
          className="w-32"
        />
      </Row>
      <Row label="Closing an unsaved request" hint="What happens when you close a draft tab">
        <Select
          value={settings.closeDraftBehavior}
          onValueChange={(v) => update({ closeDraftBehavior: v as 'ask' | 'save' | 'discard' })}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Always ask</SelectItem>
            <SelectItem value="save">Save to a collection</SelectItem>
            <SelectItem value="discard">Close without saving</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Max history entries">
        <Input
          type="number"
          min={50}
          value={settings.maxHistoryEntries}
          onChange={(e) =>
            update({ maxHistoryEntries: Math.max(50, Number(e.target.value) || 1000) })
          }
          className="w-32"
        />
      </Row>
      <Row label="Keep cookies" hint="Store Set-Cookie responses and send them on later requests">
        <Switch
          checked={settings.cookiesEnabled}
          onCheckedChange={(cookiesEnabled) => update({ cookiesEnabled })}
        />
      </Row>
      <div>
        <div className="pb-1 text-xs">Default headers (added to every request)</div>
        <KeyValueEditor
          items={settings.defaultHeaders}
          onChange={(defaultHeaders) => update({ defaultHeaders })}
          showDescription={false}
        />
      </div>
    </Pane>
  );
}

export function ProxyPane() {
  const { settings, update } = useSettingsState();
  return (
    <Pane
      title="Proxy"
      description="Route outgoing requests through an HTTP, HTTPS or SOCKS5 proxy."
    >
      <Row label="Use a proxy" hint="Applies to all requests">
        <Switch
          checked={settings.proxy.enabled}
          onCheckedChange={(enabled) => update({ proxy: { ...settings.proxy, enabled } })}
        />
      </Row>
      {settings.proxy.enabled && (
        <>
          <Row label="Proxy URL" hint="e.g. http://proxy.corp:8080 or socks5://127.0.0.1:1080">
            <Input
              value={settings.proxy.url}
              onChange={(e) => update({ proxy: { ...settings.proxy, url: e.target.value } })}
              placeholder="http://proxy.example.com:8080"
              className="flex-1 font-mono text-xs"
            />
          </Row>
          <Row label="Bypass proxy for" hint="Comma-separated hosts, e.g. localhost,.internal">
            <Input
              value={settings.proxy.noProxy}
              onChange={(e) => update({ proxy: { ...settings.proxy, noProxy: e.target.value } })}
              placeholder="localhost,127.0.0.1"
              className="flex-1 font-mono text-xs"
            />
          </Row>
        </>
      )}
    </Pane>
  );
}

export function CertificatesPane() {
  const { settings, update } = useSettingsState();
  return (
    <Pane title="Certificates" description="TLS verification, custom CAs and mutual TLS.">
      <Row label="Verify TLS certificates" hint="Turn off only for local/self-signed servers">
        <Switch
          checked={settings.tls.verify}
          onCheckedChange={(verify) => update({ tls: { ...settings.tls, verify } })}
        />
      </Row>
      <Row label="Custom CA certificate" hint="PEM file added to the trusted roots (corporate CAs)">
        <Input
          value={settings.tls.caCertPath}
          onChange={(e) => update({ tls: { ...settings.tls, caCertPath: e.target.value } })}
          placeholder="/path/to/ca.pem"
          className="flex-1 font-mono text-xs"
        />
      </Row>
      <Row label="Client certificate" hint="PEM with certificate + private key for mutual TLS">
        <Input
          value={settings.tls.clientIdentityPath}
          onChange={(e) => update({ tls: { ...settings.tls, clientIdentityPath: e.target.value } })}
          placeholder="/path/to/client.pem"
          className="flex-1 font-mono text-xs"
        />
      </Row>
    </Pane>
  );
}

export function GitSyncPane() {
  const { settings, update } = useSettingsState();
  const setDialog = useUi((s) => s.setDialog);
  return (
    <Pane title="Git sync" description="Keep workspaces in sync with a Git repository.">
      <Row label="Auto sync" hint="Pull in the background on an interval">
        <Switch
          checked={settings.autoSyncEnabled}
          onCheckedChange={(autoSyncEnabled) => update({ autoSyncEnabled })}
        />
      </Row>
      <Row label="Auto sync interval (min)" hint="Minimum 5 minutes">
        <Input
          type="number"
          min={5}
          value={settings.autoSyncIntervalMin}
          onChange={(e) => update({ autoSyncIntervalMin: Number(e.target.value) || 0 })}
          onBlur={(e) => {
            // enforce the 5-minute floor once the user is done typing
            if (Number(e.target.value) < 5) update({ autoSyncIntervalMin: 5 });
          }}
          className="w-24"
        />
      </Row>
      <Row label="Repository settings">
        <Button variant="outline" size="sm" onClick={() => setDialog('git')}>
          Open Git panel
        </Button>
      </Row>
    </Pane>
  );
}

export function DataPane() {
  const [backingUp, setBackingUp] = React.useState(false);

  const backup = async () => {
    setBackingUp(true);
    try {
      const { downloadRepoBackup } = await import('@/features/git/backup');
      const count = await downloadRepoBackup();
      toast('success', 'Backup downloaded', `${count} file(s) zipped.`);
    } catch (err) {
      toast('error', 'Backup failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <Pane title="Backup & reset" description="Export everything, or start over from scratch.">
      <SubHeading>Backup</SubHeading>
      <Row
        label="Backup"
        hint="Download a ZIP of the whole repo — every workspace, collection and environment (plus git history when a repo exists)"
      >
        <Button variant="outline" size="sm" disabled={backingUp} onClick={() => void backup()}>
          <Archive /> {backingUp ? 'Preparing…' : 'Download backup (.zip)'}
        </Button>
      </Row>

      <SubHeading danger>Danger zone</SubHeading>
      <Row
        label="Delete All Data"
        hint="Wipes every workspace, collection, environment, history, git storage, settings, cookies and local storage"
      >
        <Button
          variant="destructive"
          size="sm"
          onClick={() =>
            useUi.getState().requestConfirm({
              title: 'Delete ALL data?',
              message:
                'Everything will be PERMANENTLY deleted: all workspaces, collections, requests, environments, history, saved responses, git repositories, settings, cookies and local storage. The app restarts from scratch. This cannot be undone.',
              confirmLabel: 'Delete everything',
              onConfirm: () => void wipeAllData(),
            })
          }
        >
          <Trash2 /> Delete All Data
        </Button>
      </Row>
    </Pane>
  );
}
