import * as React from 'react';
import { Code2, Save, Share2, Star } from 'lucide-react';
import type { ApiRequest, HttpMethod, KeyValue } from '@/types/models';
import { formDataFiles, HTTP_METHODS } from '@/types/models';
import { useTabs } from '@/store/tabs';
import { useData } from '@/store/data';
import { useUi, toast } from '@/store/ui';
import { cancelTab, executeTab, updateTabRequest } from '@/features/http/execute';
import { paramsFromUrl, urlFromParams } from '@/features/http/urlSync';
import {
  appendPathParamToUrl,
  pathParamNames,
  pathParamsFromUrl,
  removePathParamFromUrl,
  renamePathParamInUrl,
} from '@/features/http/pathParams';
import { buildShareUrl } from '@/features/share/deepLink';
import { CODEGEN_FORMATS } from '@/features/codegen/generate';
import { copyText } from '@/platform/system';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, methodColorClass, requestBadge } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch, TabStrip } from '@/components/ui/misc';
import { Splitter } from '@/components/layout/Splitter';
import { KeyValueEditor } from './KeyValueEditor';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { UrlInput } from './UrlInput';
import { LazyCodeEditor } from '@/components/editor/LazyCodeEditor';
import { ResponsePanel } from '@/components/response/ResponsePanel';
import { RealtimeView } from './RealtimeView';
import { VariablesEditor } from '@/components/environments/VariablesEditor';

const TABS = ['params', 'auth', 'headers', 'body', 'scripts', 'variables', 'settings'] as const;
type BuilderTab = (typeof TABS)[number];

function ScriptsEditor({
  request,
  onChange,
}: {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
}) {
  const [which, setWhich] = React.useState<'pre' | 'test'>('pre');
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-0 py-0">
        <TabStrip
          tabs={['pre', 'test'] as const}
          value={which}
          onChange={setWhich}
          labels={{ pre: 'Pre-request', test: 'Post-response' }}
          className="border-b-0"
        />
        <span className="ml-auto pr-4 text-[11px] text-muted-foreground">
          Stored with the request — execution sandbox coming later.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <LazyCodeEditor
          value={which === 'pre' ? request.preRequestScript : request.testScript}
          language="javascript"
          onChange={(value) =>
            onChange(which === 'pre' ? { preRequestScript: value } : { testScript: value })
          }
        />
      </div>
    </div>
  );
}

function SettingsEditor({
  request,
  onChange,
}: {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
}) {
  const s = request.settings;
  const set = (patch: Partial<ApiRequest['settings']>) =>
    onChange({ settings: { ...s, ...patch } });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <label className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">Name</span>
        <Input
          value={request.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="max-w-md"
        />
      </label>
      <label className="flex items-start gap-3">
        <span className="w-40 shrink-0 pt-1.5 text-xs text-muted-foreground">Description</span>
        <Textarea
          value={request.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="max-w-md"
          placeholder="What does this request do?"
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">Tags (comma-separated)</span>
        <Input
          value={request.tags.join(', ')}
          onChange={(e) =>
            onChange({
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          className="max-w-md"
          placeholder="auth, smoke-test"
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">
          Timeout (ms, 0 = default)
        </span>
        <Input
          type="number"
          value={s.timeoutMs}
          onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })}
          className="w-32"
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">Follow redirects</span>
        <Switch
          checked={s.followRedirects}
          onCheckedChange={(followRedirects) => set({ followRedirects })}
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="w-40 shrink-0 text-xs text-muted-foreground">Verify SSL</span>
        <Switch checked={s.verifySsl} onCheckedChange={(verifySsl) => set({ verifySsl })} />
        <span className="text-[11px] text-muted-foreground">
          Off = accept self-signed / invalid certificates for this request.
        </span>
      </label>
    </div>
  );
}

/**
 * Path variables are backed by `:name` placeholders in the URL, so edits to
 * the table have to rewrite the URL: renaming a key renames the placeholder,
 * a new row appends one, and deleting a row removes it.
 */
function patchPathParams(
  request: ApiRequest,
  previous: KeyValue[],
  next: KeyValue[],
): Partial<ApiRequest> {
  let url = request.url;

  // deletions: rows that were present before and are gone now
  for (const before of previous) {
    if (before.key && !next.some((n) => n.id === before.id)) {
      url = removePathParamFromUrl(url, before.key);
    }
  }

  for (const row of next) {
    const before = previous.find((p) => p.id === row.id);
    if (!row.key) continue;
    if (!before || !before.key) {
      // brand new row (or a row that just got its first name)
      if (!pathParamNames(url).includes(row.key)) url = appendPathParamToUrl(url, row.key);
    } else if (before.key !== row.key) {
      url = renamePathParamInUrl(url, before.key, row.key);
    }
  }

  // keys are owned by the URL, so re-derive to stay in sync
  return { url, pathParams: pathParamsFromUrl(url, next) };
}

/** True when the body tab actually carries a payload for the selected body type. */
function hasBodyPayload(request: ApiRequest): boolean {
  const body = request.body;
  switch (body.type) {
    case 'none':
      return false;
    case 'graphql':
      return !!body.graphql.query.trim() || !!body.graphql.variables.trim();
    case 'form-urlencoded':
      return body.formUrlEncoded.some((f) => f.enabled && (f.key || f.value));
    case 'multipart':
      return body.multipart.some(
        (f) => f.enabled && (f.key || f.value || formDataFiles(f).length > 0),
      );
    case 'binary':
      return !!body.binary;
    default:
      return !!body.content.trim();
  }
}

/** Breadcrumb (collection / folders / editable name) and request actions. */
function RequestHeader({
  tabId,
  request,
  isDraft,
  onChange,
}: {
  tabId: string;
  request: ApiRequest;
  isDraft: boolean;
  onChange: (patch: Partial<ApiRequest>) => void;
}) {
  const setDialog = useUi((s) => s.setDialog);
  const collection = useData((s) => (request.collectionId ? s.collections[request.collectionId] : undefined));
  const folders = useData((s) => s.folders);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(request.name);

  const trail: string[] = [];
  if (collection) {
    trail.push(collection.name);
    const chain: string[] = [];
    let f = request.folderId ? folders[request.folderId] : undefined;
    const seen = new Set<string>();
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      chain.unshift(f.name);
      f = f.parentId ? folders[f.parentId] : undefined;
    }
    trail.push(...chain);
  }
  const badge = requestBadge(request);

  const commit = () => {
    setEditing(false);
    const next = name.trim();
    if (next && next !== request.name) onChange({ name: next });
    else setName(request.name);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-4">
      <span
        className={cn(
          'shrink-0 rounded-sm border border-current/30 px-1 text-[9px] font-bold leading-4',
          badge.className,
        )}
      >
        {badge.label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
        {trail.map((t, i) => (
          <React.Fragment key={i}>
            <span className="max-w-40 truncate text-muted-foreground">{t}</span>
            <span className="text-muted-foreground/60">/</span>
          </React.Fragment>
        ))}
        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setName(request.name);
                setEditing(false);
              }
            }}
            className="h-7 max-w-80 text-xs"
          />
        ) : (
          <button
            type="button"
            title="Rename"
            onClick={() => {
              setName(request.name);
              setEditing(true);
            }}
            className="min-w-0 truncate rounded px-1 py-0.5 text-foreground hover:bg-accent"
          >
            {request.name}
          </button>
        )}
        {isDraft && <span className="shrink-0 text-[11px] text-muted-foreground">(unsaved)</span>}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="px-2.5 font-medium"
        title={isDraft ? 'Save to a collection (Ctrl+S)' : 'Saved automatically'}
        onClick={() =>
          isDraft ? setDialog('saveRequest', tabId) : toast('success', 'All changes are saved')
        }
      >
        <Save /> Save
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={
          isDraft ? 'Save this request first to share a link' : 'Copy a shareable link to this request'
        }
        disabled={isDraft}
        onClick={() => {
          const link = buildShareUrl(request.workspaceId, request.id);
          void copyText(link)
            .then(() =>
              toast('success', 'Share link copied', 'Anyone with Zorvilo and the same repo can open this request with it.'),
            )
            .catch((err) => toast('error', 'Copy failed', err instanceof Error ? err.message : String(err)));
        }}
      >
        <Share2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={request.favorite ? 'Remove favorite' : 'Favorite'}
        onClick={() => onChange({ favorite: !request.favorite })}
      >
        <Star className={cn(request.favorite && 'fill-amber-400 text-amber-400')} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="Code snippet (cURL, fetch, …)">
            <Code2 />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Copy code snippet</DropdownMenuLabel>
          {CODEGEN_FORMATS.map((format) => (
            <DropdownMenuItem
              key={format.id}
              onSelect={() => {
                void format
                  .generate(request)
                  .then((code) => copyText(code))
                  .then(() => toast('success', `Copied as ${format.label}`))
                  .catch((err) => toast('error', 'Copy failed', err instanceof Error ? err.message : String(err)));
              }}
            >
              {format.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function RequestView({ tabId }: { tabId: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const storedRequest = useData((s) => (tab ? s.requests[tab.requestId] : undefined));
  const sending = useTabs((s) => !!s.sending[tabId]);
  const responseSplit = useUi((s) => s.ui.responseSplit);
  const layout = useUi((s) => s.ui.requestLayout);
  const updateUi = useUi((s) => s.update);
  const [builderTab, setBuilderTab] = React.useState<BuilderTab>(() => {
    // GraphQL requests open straight on the query editor
    const t = useTabs.getState().tabs.find((x) => x.id === tabId);
    const r = t?.draft ?? useData.getState().requests[t?.requestId ?? ''];
    return r?.protocol === 'graphql' ? 'body' : 'params';
  });
  const containerRef = React.useRef<HTMLDivElement>(null);

  const request = tab?.draft ?? storedRequest;
  if (!tab || !request) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This request no longer exists.
      </div>
    );
  }

  const onChange = (patch: Partial<ApiRequest>) => updateTabRequest(tabId, patch);
  const send = () => void executeTab(tabId);
  const cancel = () => cancelTab(tabId);

  // WebSocket / Socket.IO get their own client view
  if (request.protocol === 'ws' || request.protocol === 'socketio') {
    return <RealtimeView tabId={tabId} request={request} onChange={onChange} />;
  }

  // The URL owns the path-variable keys, so derive them for display — requests
  // saved before path params existed then show their :placeholders right away.
  const pathParams = pathParamsFromUrl(request.url, request.pathParams ?? []);

  const counts = {
    params: request.params.filter((p) => p.enabled && p.key).length + pathParams.length,
    headers: request.headers.filter((h) => h.enabled && h.key).length,
    variables: request.variables.filter((v) => v.enabled && v.key).length,
  };

  // Body has no meaningful count, so mark it with a dot when a payload is set.
  const dots = { body: hasBodyPayload(request) };

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* Postman-style header: breadcrumb + actions */}
      <RequestHeader tabId={tabId} request={request} isDraft={!!tab.draft} onChange={onChange} />

      {/* URL bar: method + URL in one box, blue Send */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <div className="flex h-10 min-w-0 flex-1 items-stretch rounded border border-input bg-background focus-within:border-send">
          <Select
            value={request.method}
            onValueChange={(method) => onChange({ method: method as HttpMethod })}
          >
            <SelectTrigger
              className={cn(
                'h-full w-[104px] shrink-0 rounded-r-none border-0 border-r border-input bg-transparent pl-3 text-xs font-bold shadow-none focus:ring-0',
                methodColorClass(request.method),
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem
                  key={m}
                  value={m}
                  className={cn('font-bold', methodColorClass(m))}
                >
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <UrlInput
            request={request}
            className="[&_input]:h-full [&_input]:rounded-l-none [&_input]:border-0 [&_input]:shadow-none [&_input]:focus-visible:ring-0"
            onChange={(url) =>
              onChange({
                url,
                params: paramsFromUrl(url, request.params),
                pathParams: pathParamsFromUrl(url, request.pathParams ?? []),
              })
            }
            onEnter={send}
            onImportCurl={(parsed) => {
              const keepName = request.name !== 'Untitled Request' && request.name !== 'New Request';
              onChange(keepName ? parsed.patch : { ...parsed.patch, name: parsed.suggestedName });
              toast('success', 'cURL imported', 'Method, headers, body and auth were filled in.');
            }}
          />
        </div>
        {sending ? (
          <Button
            variant="secondary"
            className="h-10 w-[88px] font-semibold"
            title="Cancel request"
            onClick={cancel}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="send"
            className="h-10 w-[88px] text-[13px] font-semibold"
            onClick={send}
            title="Send (Ctrl+Enter)"
          >
            Send
          </Button>
        )}
      </div>

      {/* Builder + response: stacked or side-by-side (toggle in the bottom toolbar) */}
      <div className={cn('flex min-h-0 flex-1', layout === 'horizontal' ? 'flex-row' : 'flex-col')}>
        <div
          style={{ flexBasis: `${(1 - responseSplit) * 100}%` }}
          className={cn('flex flex-col', layout === 'horizontal' ? 'min-w-52' : 'min-h-24')}
        >
          <TabStrip
            tabs={TABS}
            value={builderTab}
            onChange={setBuilderTab}
            counts={counts}
            dots={dots}
            labels={{
              params: 'Params',
              headers: 'Headers',
              body: 'Body',
              auth: 'Authorization',
              scripts: 'Scripts',
              variables: 'Variables',
              settings: 'Settings',
            }}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            {builderTab === 'params' && (
              <div className="h-full overflow-y-auto px-4 pb-4 pt-3">
                <div className="pb-2 text-xs font-semibold text-muted-foreground">
                  Query Params
                </div>
                <KeyValueEditor
                  request={request}
                  items={request.params}
                  onChange={(params) =>
                    onChange({ params, url: urlFromParams(request.url, params) })
                  }
                />
                <div className="pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                  Path Variables
                </div>
                <KeyValueEditor
                  request={request}
                  items={pathParams}
                  onChange={(next) => onChange(patchPathParams(request, pathParams, next))}
                  keyPlaceholder="Variable name"
                />
                <div className="pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                  Cookies
                </div>
                <KeyValueEditor
                  request={request}
                  items={request.cookies}
                  onChange={(cookies) => onChange({ cookies })}
                  keyPlaceholder="Cookie name"
                />
              </div>
            )}
            {builderTab === 'headers' && (
              <div className="h-full overflow-y-auto px-4 pb-4 pt-3">
                <div className="pb-2 text-xs font-semibold text-muted-foreground">Headers</div>
                <KeyValueEditor
                  request={request}
                  items={request.headers}
                  onChange={(headers) => onChange({ headers })}
                />
              </div>
            )}
            {builderTab === 'body' && <BodyEditor request={request} onChange={onChange} />}
            {builderTab === 'auth' && (
              <div className="h-full overflow-y-auto">
                <AuthEditor
                  auth={request.auth}
                  onChange={(auth) => onChange({ auth })}
                  allowInherit={!!request.collectionId}
                />
              </div>
            )}
            {builderTab === 'scripts' && <ScriptsEditor request={request} onChange={onChange} />}
            {builderTab === 'variables' && (
              <div className="h-full overflow-y-auto px-4 pb-4 pt-3">
                <div className="pb-2 text-xs text-muted-foreground">
                  Request-scoped variables (highest precedence).
                </div>
                <VariablesEditor
                  variables={request.variables}
                  onChange={(variables) => onChange({ variables })}
                />
              </div>
            )}
            {builderTab === 'settings' && <SettingsEditor request={request} onChange={onChange} />}
          </div>
        </div>

        <Splitter
          orientation={layout === 'horizontal' ? 'vertical' : 'horizontal'}
          onDrag={(delta) => {
            const size =
              layout === 'horizontal'
                ? (containerRef.current?.clientWidth ?? 1200)
                : (containerRef.current?.clientHeight ?? 800);
            updateUi({
              responseSplit: Math.min(0.85, Math.max(0.1, responseSplit - delta / size)),
            });
          }}
        />

        {/* Response */}
        <div
          style={{ flexBasis: `${responseSplit * 100}%` }}
          className={layout === 'horizontal' ? 'min-w-52' : 'min-h-24'}
        >
          <ResponsePanel tabId={tabId} request={request} />
        </div>
      </div>
    </div>
  );
}
