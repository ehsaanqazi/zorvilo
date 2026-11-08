import * as React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Play,
  Square,
  XCircle,
} from 'lucide-react';
import type { ApiRequest, Folder, ResponseData } from '@/types/models';
import type { TestResult } from '@/types/models';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';
import { performRequest } from '@/features/http/execute';
import { cn, formatBytes, formatDuration, methodColorClass, statusColorClass, tryFormatJson, isJsonContentType } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox, TabStrip } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RunSummary {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  error: string | null;
  tests: TestResult[];
}

interface RunResult {
  requestId: string;
  requestName: string;
  method: ApiRequest['method'];
  iteration: number;
  status: 'pending' | 'running' | 'done' | 'skipped';
  summary?: RunSummary;
  /** full details, kept in memory only while the dialog is open */
  detail?: { request: ApiRequest; response: ResponseData };
}

/** Requests of a collection (or folder subtree) in tree order. */
function useOrderedRequests(collectionId: string, folderId: string | null): ApiRequest[] {
  const folders = useData((s) => s.folders);
  const requests = useData((s) => s.requests);
  return React.useMemo(() => {
    const bySort = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    const childFolders = (parentId: string | null): Folder[] =>
      Object.values(folders)
        .filter((f) => f.collectionId === collectionId && f.parentId === parentId)
        .sort(bySort);
    const requestsIn = (fid: string | null): ApiRequest[] =>
      Object.values(requests)
        .filter(
          (r) =>
            r.collectionId === collectionId &&
            r.folderId === fid &&
            // realtime requests can't run in the HTTP pipeline
            r.protocol !== 'ws' &&
            r.protocol !== 'socketio',
        )
        .sort(bySort);
    const out: ApiRequest[] = [];
    const walk = (fid: string | null) => {
      for (const f of childFolders(fid)) walk(f.id);
      out.push(...requestsIn(fid));
    };
    walk(folderId);
    return out;
  }, [folders, requests, collectionId, folderId]);
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
      {children}
    </pre>
  );
}

const DETAIL_TABS = ['params', 'headers', 'body', 'response', 'resHeaders'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

/** Expanded row: full run details in tabs, mirroring the request window. */
function RunDetail({ detail }: { detail: { request: ApiRequest; response: ResponseData } }) {
  const { request, response } = detail;
  const [tab, setTab] = React.useState<DetailTab>('response');
  const reqHeaders = request.headers.filter((h) => h.enabled && h.key);
  const params = request.params.filter((p) => p.enabled && p.key);
  const body =
    request.body.type === 'graphql'
      ? `query:\n${request.body.graphql.query}\n\nvariables:\n${request.body.graphql.variables}`
      : request.body.type === 'form-urlencoded'
        ? request.body.formUrlEncoded
            .filter((i) => i.enabled && i.key)
            .map((i) => `${i.key}=${i.value}`)
            .join('&')
        : request.body.content;

  return (
    <div className="ml-6 mb-2 flex flex-col gap-2 rounded border bg-card/60 p-2">
      <Mono>
        {request.method} {request.url}
      </Mono>
      <TabStrip
        tabs={DETAIL_TABS}
        value={tab}
        onChange={setTab}
        labels={{
          params: 'Params',
          headers: 'Headers',
          body: 'Body',
          response: 'Response',
          resHeaders: 'Response Headers',
        }}
        counts={{
          params: params.length,
          headers: reqHeaders.length,
          resHeaders: response.headers.length,
        }}
      />
      {tab === 'params' && (
        <Mono>
          {params.length > 0
            ? params.map((p) => `${p.key}=${p.value}`).join('\n')
            : '(no query params)'}
        </Mono>
      )}
      {tab === 'headers' && (
        <Mono>
          {reqHeaders.length > 0
            ? reqHeaders.map((h) => `${h.key}: ${h.value}`).join('\n')
            : '(no headers)'}
        </Mono>
      )}
      {tab === 'body' && (
        <Mono>{request.body.type !== 'none' && body ? body : '(no body)'}</Mono>
      )}
      {tab === 'response' && (
        <Mono>
          {response.error
            ? response.error
            : isJsonContentType(response.contentType)
              ? tryFormatJson(response.bodyText)
              : response.bodyText || '(empty)'}
        </Mono>
      )}
      {tab === 'resHeaders' && (
        <Mono>
          {response.headers.length > 0
            ? response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')
            : '(no headers)'}
        </Mono>
      )}
      <div className="text-[10px] text-muted-foreground">
        {formatBytes(response.sizeBytes)} · {formatDuration(response.durationMs)}
      </div>
    </div>
  );
}

export function RunnerDialog() {
  const open = useUi((s) => s.openDialog === 'runner');
  const target = useUi((s) => s.runnerTarget);
  const setDialog = useUi((s) => s.setDialog);
  const collection = useData((s) => (target ? s.collections[target.collectionId] : undefined));
  const ordered = useOrderedRequests(target?.collectionId ?? '', target?.folderId ?? null);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [delayMs, setDelayMs] = React.useState(0);
  const [iterations, setIterations] = React.useState(1);
  const [preserve, setPreserve] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<RunResult[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const stopRef = React.useRef(false);

  React.useEffect(() => {
    if (open) {
      setSelected(new Set(ordered.map((r) => r.id)));
      setResults([]);
      setExpanded(new Set());
      setRunning(false);
      stopRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.collectionId, target?.folderId]);

  if (!open || !target || !collection) return null;

  const closeDialog = () => {
    // run data lives only in this dialog — closing throws it all away
    setResults([]);
    setExpanded(new Set());
    setRunning(false);
    stopRef.current = true;
    setDialog(null);
  };

  const run = async () => {
    const perIteration = ordered.filter((r) => selected.has(r.id));
    const queue: { request: ApiRequest; iteration: number }[] = [];
    for (let iter = 1; iter <= iterations; iter++) {
      for (const request of perIteration) queue.push({ request, iteration: iter });
    }
    setRunning(true);
    stopRef.current = false;
    setExpanded(new Set());
    setResults(
      queue.map(({ request, iteration }) => ({
        requestId: request.id,
        requestName: request.name,
        method: request.method,
        iteration,
        status: 'pending',
      })),
    );

    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) {
        setResults((prev) => prev.map((p, idx) => (idx >= i ? { ...p, status: 'skipped' } : p)));
        break;
      }
      const { request, iteration } = queue[i]!;
      setResults((prev) => prev.map((p, idx) => (idx === i ? { ...p, status: 'running' } : p)));
      // pm.info.iteration is zero-based, like Postman
      const result = await performRequest(request, undefined, {
        iteration: iteration - 1,
        iterationCount: iterations,
      });
      const summary: RunSummary = {
        status: result.response.status,
        statusText: result.response.statusText,
        durationMs: result.response.durationMs,
        sizeBytes: result.response.sizeBytes,
        error: result.response.error,
        tests: result.tests,
      };
      setResults((prev) =>
        prev.map((p, idx) =>
          idx === i
            ? {
                ...p,
                status: 'done',
                summary,
                detail: preserve
                  ? { request: structuredClone(request), response: result.response }
                  : undefined,
              }
            : p,
        ),
      );
      if (delayMs > 0 && i < queue.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    setRunning(false);
  };

  const done = results.filter((r) => r.status === 'done');
  const totalTests = done.flatMap((r) => r.summary?.tests ?? []);
  const passedTests = totalTests.filter((t) => t.passed).length;
  // success = HTTP status in the 200 range; everything else counts as failed
  const successCount = done.filter(
    (r) => r.summary && !r.summary.error && r.summary.status >= 200 && r.summary.status < 300,
  ).length;
  const failedCount = done.length - successCount;
  const avgMs =
    done.length > 0
      ? done.reduce((sum, r) => sum + (r.summary?.durationMs ?? 0), 0) / done.length
      : 0;
  const idle = !running && results.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && closeDialog()}>
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-4 text-primary" />
            Run {collection.name}
            {target.folderId && ' (folder)'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={running || selected.size === 0} onClick={() => void run()}>
            <Play /> Run {selected.size} request(s)
          </Button>
          {running && (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>
              <Square /> Stop
            </Button>
          )}
          {idle && (
            <>
              <Button
                variant="link"
                size="sm"
                className="h-6 px-1"
                onClick={() => setSelected(new Set(ordered.map((r) => r.id)))}
              >
                Select all
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-6 px-1"
                onClick={() => setSelected(new Set())}
              >
                Deselect all
              </Button>
            </>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={preserve}
              disabled={running}
              onCheckedChange={(checked) => setPreserve(checked === true)}
            />
            Preserve responses
          </label>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Iterations
            <Input
              type="number"
              min={1}
              value={iterations}
              onChange={(e) => setIterations(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
              className="h-7 w-20"
              disabled={running}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Delay (ms)
            <Input
              type="number"
              min={0}
              value={delayMs}
              onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
              className="h-7 w-24"
              disabled={running}
            />
          </label>
        </div>

        {results.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border bg-muted/40 px-3 py-2 text-xs">
            <span>
              <span className="font-semibold">{done.length}</span>/{results.length} completed
            </span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {successCount} success
            </span>
            <span className={cn('font-medium', failedCount > 0 ? 'text-destructive' : 'text-muted-foreground')}>
              {failedCount} failed
            </span>
            <span className="text-muted-foreground">
              avg {formatDuration(avgMs)}
            </span>
            {totalTests.length > 0 && (
              <span>
                tests: {passedTests}/{totalTests.length} passed
              </span>
            )}
            {preserve && done.length > 0 && (
              <span className="text-muted-foreground">click a request to inspect it</span>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded border">
          {idle
            ? ordered.map((request) => (
                <div key={request.id} className="border-b border-border/50">
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-accent/50">
                    <Checkbox
                      checked={selected.has(request.id)}
                      onCheckedChange={(checked) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked === true) next.add(request.id);
                          else next.delete(request.id);
                          return next;
                        });
                      }}
                    />
                    <span className={cn('w-12 shrink-0 font-mono text-[10px] font-semibold', methodColorClass(request.method))}>
                      {request.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{request.name}</span>
                  </label>
                </div>
              ))
            : results.map((res, idx) => {
                const testFails = res.summary?.tests.filter((t) => !t.passed) ?? [];
                const canExpand = !!res.detail;
                const key = String(idx);
                const isExpanded = expanded.has(key);
                const showIterationHeader =
                  iterations > 1 && (idx === 0 || results[idx - 1]!.iteration !== res.iteration);
                return (
                  <React.Fragment key={key}>
                    {showIterationHeader && (
                      <div className="border-b bg-muted/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Iteration {res.iteration}
                      </div>
                    )}
                    <div className="border-b border-border/50">
                      <div
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5',
                          canExpand && 'cursor-pointer hover:bg-accent/50',
                        )}
                        onClick={() => {
                          if (!canExpand) return;
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                      >
                        {canExpand &&
                          (isExpanded ? (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          ))}
                        {res.status === 'running' ? (
                          <CircleDashed className="size-4 shrink-0 animate-spin text-primary" />
                        ) : res.status === 'done' ? (
                          res.summary!.error ||
                          res.summary!.status < 200 ||
                          res.summary!.status >= 300 ||
                          testFails.length > 0 ? (
                            <XCircle className="size-4 shrink-0 text-destructive" />
                          ) : (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          )
                        ) : (
                          <CircleDashed className="size-4 shrink-0 text-muted-foreground/40" />
                        )}
                        <span className={cn('w-12 shrink-0 font-mono text-[10px] font-semibold', methodColorClass(res.method))}>
                          {res.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{res.requestName}</span>
                        {res.summary && (
                          <>
                            {res.summary.error ? (
                              <span className="text-xs text-destructive">failed</span>
                            ) : (
                              <span className={cn('text-xs font-semibold', statusColorClass(res.summary.status))}>
                                {res.summary.status}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(res.summary.durationMs)}
                            </span>
                            {res.summary.tests.length > 0 && (
                              <span
                                className={cn(
                                  'text-xs',
                                  testFails.length > 0 ? 'text-destructive' : 'text-emerald-500',
                                )}
                              >
                                {res.summary.tests.length - testFails.length}/
                                {res.summary.tests.length} tests
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {res.summary?.error && !isExpanded && (
                        <div className="ml-8 truncate pb-1 text-[11px] text-muted-foreground">
                          {res.summary.error}
                        </div>
                      )}
                      {testFails.length > 0 &&
                        !isExpanded &&
                        testFails.map((t, i) => (
                          <div key={i} className="ml-8 pb-0.5 text-[11px] text-destructive">
                            ✗ {t.name} — {t.error}
                          </div>
                        ))}
                      {isExpanded && res.detail && <RunDetail detail={res.detail} />}
                    </div>
                  </React.Fragment>
                );
              })}
          {idle && ordered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No requests to run.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
