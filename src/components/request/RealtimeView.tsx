import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, Eraser, Info, Plug, Save, Send, Unplug } from 'lucide-react';
import type { ApiRequest } from '@/types/models';
import { useRealtime } from '@/store/realtime';
import { useUi } from '@/store/ui';
import { useTabs } from '@/store/tabs';
import { buildScopeVariableMap } from '@/features/http/execute';
import { resolveTemplate } from '@/features/variables/resolve';
import { cn, formatTimestamp, requestBadge } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { UrlInput } from './UrlInput';

/** WebSocket / Socket.IO client view (replaces the HTTP builder for these protocols). */
export function RealtimeView({
  tabId,
  request,
  onChange,
}: {
  tabId: string;
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
}) {
  const conn = useRealtime((s) => s.connections[tabId]);
  const { connect, disconnect, send, clearMessages } = useRealtime();
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const setDialog = useUi((s) => s.setDialog);
  const [draft, setDraft] = React.useState('');
  const [eventName, setEventName] = React.useState('message');
  const logRef = React.useRef<HTMLDivElement>(null);

  const status = conn?.status ?? 'disconnected';
  const messages = conn?.messages ?? [];
  const isSocketIo = request.protocol === 'socketio';
  const badge = requestBadge(request);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length]);

  const doConnect = () => {
    const vars = buildScopeVariableMap(request);
    // handshake headers (a desktop-only capability: browsers can't set them)
    const headers = request.headers
      .filter((h) => h.enabled && h.key.trim())
      .map((h) => [resolveTemplate(h.key, vars), resolveTemplate(h.value, vars)] as [string, string]);
    connect(tabId, isSocketIo ? 'socketio' : 'ws', resolveTemplate(request.url, vars), headers);
  };

  const doSend = () => {
    if (!draft.trim()) return;
    const vars = buildScopeVariableMap(request);
    send(tabId, resolveTemplate(draft, vars), isSocketIo ? eventName || 'message' : undefined);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      {/* connection bar */}
      <div className="flex items-center gap-2 border-b p-2.5">
        <span className={cn('w-12 shrink-0 text-center text-xs font-bold', badge.className)}>
          {badge.label}
        </span>
        <UrlInput request={request} onChange={(url) => onChange({ url })} onEnter={doConnect} />
        {tab?.draft && (
          <Button variant="outline" title="Save to a collection" onClick={() => setDialog('saveRequest', tabId)}>
            <Save /> Save
          </Button>
        )}
        {status === 'connected' ? (
          <Button variant="destructive" onClick={() => disconnect(tabId)}>
            <Unplug /> Disconnect
          </Button>
        ) : (
          <Button variant="send" onClick={doConnect} disabled={status === 'connecting' || !request.url.trim()}>
            <Plug /> {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>

      {/* status strip */}
      <div className="flex items-center gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'connected'
              ? 'bg-emerald-500'
              : status === 'connecting'
                ? 'animate-pulse bg-amber-500'
                : 'bg-muted-foreground/40',
          )}
        />
        {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
        {isSocketIo && <span>· Socket.IO (Engine.IO v4, websocket transport)</span>}
        <span className="flex-1" />
        <Button variant="ghost" size="iconSm" title="Clear messages" onClick={() => clearMessages(tabId)}>
          <Eraser />
        </Button>
      </div>

      {/* message log */}
      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {isSocketIo
              ? 'Connect, then emit events — received events appear here.'
              : 'Connect, then send messages — incoming frames appear here.'}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2 border-b border-border/40 px-1 py-1.5">
            {m.dir === 'in' ? (
              <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            ) : m.dir === 'out' ? (
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : (
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              {m.event && (
                <span className="mr-2 rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                  {m.event}
                </span>
              )}
              <pre
                className={cn(
                  'inline whitespace-pre-wrap break-all font-mono text-[12px]',
                  m.dir === 'sys' && 'text-muted-foreground',
                )}
              >
                {m.text}
              </pre>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatTimestamp(m.ts)}
            </span>
          </div>
        ))}
      </div>

      {/* composer */}
      <div className="flex items-end gap-2 border-t p-2">
        {isSocketIo && (
          <label className="flex w-40 shrink-0 flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Event</span>
            <Input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="message"
              className="h-8 font-mono text-xs"
            />
          </label>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              doSend();
            }
          }}
          placeholder={
            isSocketIo
              ? 'Payload — JSON or plain text ({{variables}} work). Ctrl+Enter to emit.'
              : 'Message — text or JSON ({{variables}} work). Ctrl+Enter to send.'
          }
          className="min-h-10 flex-1 resize-y font-mono text-xs"
          rows={2}
        />
        <Button variant="send" onClick={doSend} disabled={status !== 'connected' || !draft.trim()}>
          <Send /> {isSocketIo ? 'Emit' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
