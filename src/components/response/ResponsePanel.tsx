import * as React from 'react';
import { copyText } from '@/platform/system';
import { ArrowLeft, Check, CheckCircle2, Copy, Download, Pencil, Save, Trash2, XCircle, Send } from 'lucide-react';
import type { ApiRequest, ResponseData } from '@/types/models';
import { useTabs } from '@/store/tabs';
import { useUi, toast, confirmDelete } from '@/store/ui';
import { useSavedResponses } from '@/store/responses';
import { useSettings } from '@/store/settings';
import {
  base64ToBytes,
  cn,
  downloadBlob,
  formatBytes,
  formatDuration,
  isJsonContentType,
  matches,
  slugify,
  statusColorClass,
  statusPillClass,
  tryFormatJson,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, TabStrip } from '@/components/ui/misc';
import { LazyCodeEditor, LazyDiffEditor } from '@/components/editor/LazyCodeEditor';

const TABS = ['body', 'cookies', 'headers', 'tests', 'saved'] as const;
type ResponseTab = (typeof TABS)[number];
const BODY_MODES = ['pretty', 'raw', 'preview'] as const;
type BodyMode = (typeof BODY_MODES)[number];

function monacoLanguage(contentType: string): string {
  if (isJsonContentType(contentType)) return 'json';
  if (/xml/i.test(contentType)) return 'xml';
  if (/html/i.test(contentType)) return 'html';
  if (/javascript/i.test(contentType)) return 'javascript';
  if (/css/i.test(contentType)) return 'css';
  return 'plaintext';
}

function downloadResponse(response: ResponseData, baseName: string) {
  const ext = isJsonContentType(response.contentType)
    ? 'json'
    : /html/.test(response.contentType)
      ? 'html'
      : /xml/.test(response.contentType)
        ? 'xml'
        : 'txt';
  const blob = response.bodyBase64
    ? new Blob([base64ToBytes(response.bodyBase64).buffer as ArrayBuffer], {
        type: response.contentType,
      })
    : new Blob([response.bodyText], { type: response.contentType || 'text/plain' });
  void downloadBlob(blob, `${slugify(baseName)}-response.${response.bodyBase64 ? 'bin' : ext}`);
}

function HeadersTable({ headers }: { headers: [string, string][] }) {
  const [filter, setFilter] = React.useState('');
  const rows = headers.filter(([k, v]) => matches(k, filter) || matches(v, filter));
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2">
        <Input
          placeholder="Filter headers"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 max-w-64"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <table className="w-full table-fixed border text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-[35%] border-r px-2.5 py-1.5 font-semibold">Key</th>
              <th className="px-2.5 py-1.5 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, value], i) => (
              <tr key={`${key}-${i}`} className="border-b last:border-b-0 hover:bg-muted/60">
                <td className="w-[35%] border-r px-2.5 py-1.5 align-top break-words">{key}</td>
                <td className="break-all px-2.5 py-1.5">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">No headers</div>}
      </div>
    </div>
  );
}

function CookiesView({ response }: { response: ResponseData }) {
  const setCookies = response.headers.filter(([k]) => k.toLowerCase() === 'set-cookie');
  return (
    <div className="h-full overflow-y-auto p-3">
      {setCookies.length > 0 ? (
        <table className="w-full text-xs">
          <tbody>
            {setCookies.map(([, value], i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="break-all py-1 font-mono">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground">
          No cookies were set by this response. Cookies the server sets with{' '}
          <code className="font-mono">Set-Cookie</code> are kept and sent on later requests while
          &quot;Keep cookies&quot; is on in Settings.
        </p>
      )}
    </div>
  );
}

function BodyView({ response, mode }: { response: ResponseData; mode: BodyMode }) {
  const jsonIndent = useSettings((s) => s.settings.jsonIndent);
  const isJson = isJsonContentType(response.contentType);
  const isHtml = /html/i.test(response.contentType);
  const isImage = /^image\//i.test(response.contentType);

  if (mode === 'preview') {
    if (isImage && response.bodyBase64) {
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <img
            src={`data:${response.contentType};base64,${response.bodyBase64}`}
            alt="Response preview"
            className="max-h-full max-w-full"
          />
        </div>
      );
    }
    if (isHtml) {
      return (
        <iframe
          title="Response preview"
          sandbox=""
          srcDoc={response.bodyText}
          className="h-full w-full bg-white"
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Preview is available for HTML and image responses.
      </div>
    );
  }

  const text =
    mode === 'pretty' && isJson ? tryFormatJson(response.bodyText, jsonIndent) : response.bodyText;

  return (
    <LazyCodeEditor
      value={text}
      language={mode === 'pretty' ? monacoLanguage(response.contentType) : 'plaintext'}
      readOnly
    />
  );
}

function ModeToggle({ mode, setMode }: { mode: BodyMode; setMode: (m: BodyMode) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {BODY_MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cn(
            'h-6 rounded px-2 capitalize',
            mode === m
              ? 'bg-highlight font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="iconSm"
      title="Copy body"
      onClick={() => {
        void copyText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function TestsView({ tabId }: { tabId: string }) {
  const results = useTabs((s) => s.testResults[tabId]);
  if (!results || (results.tests.length === 0 && results.logs.length === 0 && !results.error)) {
    return (
      <EmptyState title="No test results">
        Write tests in the Scripts tab, e.g.{' '}
        <code className="font-mono">
          pm.test("status is 200", () =&gt; pm.response.to.have.status(200))
        </code>
      </EmptyState>
    );
  }
  const passed = results.tests.filter((t) => t.passed).length;
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
      {results.error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
          <span className="font-semibold text-destructive">Script error:</span> {results.error}
        </div>
      )}
      {results.tests.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground">
            {passed}/{results.tests.length} tests passed
          </div>
          <div className="flex flex-col gap-1">
            {results.tests.map((t, i) => (
              <div key={i} className="flex items-start gap-2 rounded border px-2 py-1.5 text-xs">
                {t.passed ? (
                  <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="mt-px size-3.5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{t.name}</div>
                  {t.error && <div className="text-muted-foreground">{t.error}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {results.logs.length > 0 && (
        <>
          <div className="pt-1 text-xs font-semibold">Console</div>
          <pre className="overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
            {results.logs.join('\n')}
          </pre>
        </>
      )}
    </div>
  );
}

/** Postman-style saved responses ("examples"): list → click to view/diff. */
function SavedResponsesView({
  requestId,
  response: liveResponse,
  focus,
}: {
  requestId: string;
  /** the tab's current live response, for diffing */
  response: ResponseData | undefined;
  /** saved response to open (e.g. clicked in the sidebar); `n` re-triggers on repeat clicks */
  focus: { id: string; n: number } | null;
}) {
  const savedResponses = useSavedResponses((s) => s.savedResponses);
  const jsonIndent = useSettings((s) => s.settings.jsonIndent);
  const { rename, remove } = useSavedResponses();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [savedTab, setSavedTab] = React.useState<'body' | 'headers' | 'diff'>('body');
  const [mode, setMode] = React.useState<BodyMode>('pretty');
  const [renaming, setRenaming] = React.useState(false);
  const [nameValue, setNameValue] = React.useState('');

  React.useEffect(() => {
    if (!focus) return;
    setSelectedId(focus.id);
    setSavedTab('body');
    setMode('pretty');
    setRenaming(false);
  }, [focus]);

  const forRequest = React.useMemo(
    () => savedResponses.filter((r) => r.requestId === requestId),
    [savedResponses, requestId],
  );
  const selected = forRequest.find((r) => r.id === selectedId);

  if (!selected) {
    return (
      <div className="h-full overflow-y-auto">
        {forRequest.length === 0 ? (
          <EmptyState icon={<Save />} title="No saved responses">
            Send a request and click the save icon to keep a response. Saved responses survive
            reloads.
          </EmptyState>
        ) : (
          <div className="flex flex-col p-1.5">
            {forRequest.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedId(r.id);
                  setSavedTab('body');
                  setMode('pretty');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelectedId(r.id);
                }}
                className="group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
              >
                <Save className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{r.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {r.method} {r.url}
                  </span>
                </span>
                <span className={cn('shrink-0 text-xs font-semibold', statusColorClass(r.response.status))}>
                  {r.response.status}
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  className="invisible shrink-0 group-hover:visible"
                  title="Delete saved response"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmDelete('saved response', r.name, () => remove(r.id), {
                      permanent: true,
                    });
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const response = selected.response;
  // the diff tab needs a live response — fall back to body if it disappeared
  const effectiveSavedTab =
    savedTab === 'diff' && (!liveResponse || liveResponse.error) ? 'body' : savedTab;
  const commitRename = () => {
    if (nameValue.trim()) rename(selected.id, nameValue.trim());
    setRenaming(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
        <Button variant="ghost" size="iconSm" title="Back to list" onClick={() => setSelectedId(null)}>
          <ArrowLeft />
        </Button>
        {renaming ? (
          <Input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="h-6 max-w-64"
          />
        ) : (
          <span className="min-w-0 truncate font-medium">{selected.name}</span>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          title="Rename"
          onClick={() => {
            setNameValue(selected.name);
            setRenaming(true);
          }}
        >
          <Pencil />
        </Button>
        <span className={cn('font-semibold', statusColorClass(response.status))}>
          {response.status} {response.statusText}
        </span>
        <span className="text-muted-foreground">{formatDuration(response.durationMs)}</span>
        <span className="text-muted-foreground">{formatBytes(response.sizeBytes)}</span>
        <span className="flex-1" />
        {savedTab === 'body' && <ModeToggle mode={mode} setMode={setMode} />}
        <CopyButton text={response.bodyText} />
        <Button
          variant="ghost"
          size="iconSm"
          title="Download"
          onClick={() => downloadResponse(response, selected.name)}
        >
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          title="Delete saved response"
          onClick={() =>
            confirmDelete(
              'saved response',
              selected.name,
              () => {
                remove(selected.id);
                setSelectedId(null);
              },
              { permanent: true },
            )
          }
        >
          <Trash2 />
        </Button>
      </div>
      <TabStrip
        tabs={(liveResponse && !liveResponse.error
          ? ['body', 'headers', 'diff']
          : ['body', 'headers']) as readonly ('body' | 'headers' | 'diff')[]}
        value={effectiveSavedTab}
        onChange={setSavedTab}
        counts={{ headers: response.headers.length }}
        labels={{ diff: 'Diff vs current' }}
      />
      <div className="min-h-0 flex-1">
        {effectiveSavedTab === 'body' && <BodyView response={response} mode={mode} />}
        {effectiveSavedTab === 'headers' && <HeadersTable headers={response.headers} />}
        {effectiveSavedTab === 'diff' && liveResponse && (
          <LazyDiffEditor
            original={
              isJsonContentType(response.contentType)
                ? tryFormatJson(response.bodyText, jsonIndent)
                : response.bodyText
            }
            modified={
              isJsonContentType(liveResponse.contentType)
                ? tryFormatJson(liveResponse.bodyText, jsonIndent)
                : liveResponse.bodyText
            }
            language={monacoLanguage(response.contentType)}
          />
        )}
      </div>
    </div>
  );
}

export function ResponsePanel({ tabId, request }: { tabId: string; request: ApiRequest }) {
  const response = useTabs((s) => s.responses[tabId]);
  const sending = useTabs((s) => !!s.sending[tabId]);
  const workspaceId = useUi((s) => s.ui.activeWorkspaceId);
  const savedResponses = useSavedResponses((s) => s.savedResponses);
  const saveResponse = useSavedResponses((s) => s.save);
  const [tab, setTab] = React.useState<ResponseTab>('body');
  const [mode, setMode] = React.useState<BodyMode>('pretty');

  const savedCount = React.useMemo(
    () => savedResponses.filter((r) => r.requestId === request.id).length,
    [savedResponses, request.id],
  );
  const testCount = useTabs((s) => s.testResults[tabId]?.tests.length ?? 0);

  // A saved response was clicked in the sidebar: jump to it in the Saved tab.
  const savedFocus = useUi((s) => s.savedResponseFocus);
  const [focusedSaved, setFocusedSaved] = React.useState<{ id: string; n: number } | null>(null);
  React.useEffect(() => {
    if (!savedFocus || savedFocus.requestId !== request.id) return;
    setTab('saved');
    setFocusedSaved((prev) => ({ id: savedFocus.savedId, n: (prev?.n ?? 0) + 1 }));
    useUi.getState().clearSavedResponseFocus();
  }, [savedFocus, request.id]);

  if (sending) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center border-b px-4 text-xs font-semibold text-muted-foreground">
          Response
        </div>
        <div className="h-0.5 w-full overflow-hidden bg-send/15">
          <div className="h-full w-1/3 animate-pulse bg-send" />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
          Sending request…
        </div>
      </div>
    );
  }

  const showLiveBar = tab === 'body' && response && !response.error;
  const hasLive = !!response && !response.error;

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={TABS}
        value={tab}
        onChange={setTab}
        counts={{ headers: response?.headers.length ?? 0, saved: savedCount, tests: testCount }}
        labels={{ tests: 'Test Results', saved: 'Examples' }}
        right={
          hasLive ? (
            <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-semibold leading-4',
                  statusPillClass(response.status),
                )}
              >
                {response.status} {response.statusText}
              </span>
              <span className="size-[3px] rounded-full bg-muted-foreground/60" />
              <span>{formatDuration(response.durationMs)}</span>
              <span className="size-[3px] rounded-full bg-muted-foreground/60" />
              <span>{formatBytes(response.sizeBytes)}</span>
            </div>
          ) : response?.error ? (
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold leading-4', statusPillClass(500))}>
              Error
            </span>
          ) : null
        }
      />
      {showLiveBar && (
        <div className="flex h-9 shrink-0 items-center gap-1 px-4 text-xs">
          <ModeToggle mode={mode} setMode={setMode} />
          <span className="flex-1" />
          <CopyButton text={response.bodyText} />
          <Button
            variant="ghost"
            size="iconSm"
            title="Download"
            onClick={() => downloadResponse(response, request.name)}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            title="Save response (persists across reloads)"
            onClick={() => {
              saveResponse(workspaceId, request, response);
              toast('success', 'Response saved', 'Find it under the Saved tab.');
            }}
          >
            <Save />
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {tab === 'saved' ? (
          <SavedResponsesView requestId={request.id} response={response} focus={focusedSaved} />
        ) : tab === 'tests' ? (
          <TestsView tabId={tabId} />
        ) : response?.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="text-sm font-semibold text-foreground">Could not send request</div>
            <p className="max-w-lg break-words text-xs text-muted-foreground">{response.error}</p>
          </div>
        ) : !response ? (
          <EmptyState icon={<Send />} title="Enter the URL and click Send to get a response" />
        ) : (
          <>
            {tab === 'body' && <BodyView response={response} mode={mode} />}
            {tab === 'headers' && <HeadersTable headers={response.headers} />}
            {tab === 'cookies' && <CookiesView response={response} />}
          </>
        )}
      </div>
    </div>
  );
}
