import * as React from 'react';
import type { ApiRequest } from '@/types/models';
import { useData } from '@/store/data';
import { useEnvironments } from '@/store/environments';
import { buildVariableMap } from '@/features/variables/resolve';
import { useVariableSuggestions, type VariableSuggestion } from '@/features/variables/lookup';
import { isCurlCommand, parseCurl, type ParsedCurl } from '@/features/importer';
import { cn } from '@/lib/utils';
import { VariableHoverCard } from './VariableText';
import { TOKEN_MATCH, variableClass } from '@/features/variables/highlight';
import { splitUrl } from '@/features/http/urlSync';

const TOKEN_SCAN = /\{\{\s*(\$?[\w.-]+)\s*\}\}/g;
/** Splits on {{variables}} and `:pathParams`, keeping both as parts. */
const HIGHLIGHT_SPLIT = /(\{\{\s*\$?[\w.-]+\s*\}\}|:[A-Za-z_][\w-]*)/g;
const PATH_TOKEN_MATCH = /^:[A-Za-z_][\w-]*$/;
/** input border (1px) + px-2.5 padding */
const TEXT_START_PX = 11;

interface HoverState {
  name: string;
  /** px offset of the token start inside the scrolled text */
  left: number;
}

/**
 * URL input with {{variable}} highlighting (colored overlay behind a
 * transparent-text input) and Postman-style hover cards for each variable.
 */
export function UrlInput({
  request,
  onChange,
  onEnter,
  onImportCurl,
  className,
}: {
  request: ApiRequest;
  onChange: (url: string) => void;
  onEnter?: () => void;
  /** invoked when a cURL command is pasted into the URL bar */
  onImportCurl?: (parsed: ParsedCurl) => void;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const charWidthRef = React.useRef(0);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = React.useState<HoverState | null>(null);
  /** while the card is in edit mode it stays open regardless of the pointer */
  const pinnedRef = React.useRef(false);
  const getSuggestions = useVariableSuggestions(request);
  const [suggest, setSuggest] = React.useState<{
    items: VariableSuggestion[];
    tokenStart: number;
    left: number;
    selected: number;
  } | null>(null);

  const environments = useEnvironments((s) => s.environments);
  const globals = useEnvironments((s) => s.globals);
  const collection = useData((s) =>
    request.collectionId ? s.collections[request.collectionId] : undefined,
  );

  const vars = React.useMemo(
    () =>
      buildVariableMap({
        request,
        collection: collection ?? null,
        environment: environments.find((e) => e.isActive) ?? null,
        globals,
      }),
    [request, collection, environments, globals],
  );

  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  React.useEffect(syncScroll, [request.url]);

  const measureCharWidth = (): number => {
    if (charWidthRef.current > 0) return charWidthRef.current;
    const input = inputRef.current;
    if (!input) return 7;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 7;
    ctx.font = getComputedStyle(input).font;
    charWidthRef.current = ctx.measureText('0').width; // monospace: all chars equal
    return charWidthRef.current;
  };

  const cancelHide = () => clearTimeout(hideTimer.current);
  const scheduleHide = () => {
    cancelHide();
    if (pinnedRef.current) return;
    hideTimer.current = setTimeout(() => setHover(null), 200);
  };

  /** open the {{ autocomplete when the caret sits inside an unclosed token */
  const updateSuggestions = (value: string, caret: number) => {
    const input = inputRef.current;
    if (!input) return;
    const before = value.slice(0, caret);
    const m = before.match(/\{\{(\$?[\w.-]*)$/);
    if (!m) {
      setSuggest(null);
      return;
    }
    const query = m[1]!.toLowerCase();
    const items = getSuggestions()
      .filter((s) => s.name.toLowerCase().startsWith(query))
      .slice(0, 12);
    if (items.length === 0) {
      setSuggest(null);
      return;
    }
    const tokenStart = caret - m[0].length;
    const left = TEXT_START_PX + tokenStart * measureCharWidth() - input.scrollLeft;
    setSuggest({ items, tokenStart, left: Math.max(0, left), selected: 0 });
    setHover(null);
  };

  const applySuggestion = (s: VariableSuggestion) => {
    if (!suggest) return;
    const value = request.url;
    const caret = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, suggest.tokenStart);
    let after = value.slice(caret);
    if (after.startsWith('}}')) after = after.slice(2);
    const inserted = `{{${s.name}}}`;
    onChange(before + inserted + after);
    setSuggest(null);
    const pos = before.length + inserted.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const onMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input || pinnedRef.current || !request.url.includes('{{')) return;
    const charW = measureCharWidth();
    const rect = input.getBoundingClientRect();
    const textX = e.clientX - rect.left - TEXT_START_PX + input.scrollLeft;
    const charIndex = Math.floor(textX / charW);
    if (charIndex < 0) {
      scheduleHide();
      return;
    }
    TOKEN_SCAN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_SCAN.exec(request.url)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (charIndex >= start && charIndex < end) {
        cancelHide();
        setHover((prev) => {
          const left = TEXT_START_PX + start * charW - input.scrollLeft;
          if (prev && prev.name === match![1] && Math.abs(prev.left - left) < 1) return prev;
          return { name: match![1]!, left };
        });
        return;
      }
    }
    scheduleHide();
  };

  // Split on {{variables}} and `:pathParams` so both highlight in the URL bar.
  const parts = request.url.split(HIGHLIGHT_SPLIT);
  // start offset of each part, so `:name` in the query string stays plain
  const offsets: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    offsets.push(cursor);
    cursor += part.length;
  }
  const pathEnd = splitUrl(request.url).base.length;
  // path variables resolve from the request's own table, not the variable scopes
  const pathValues = new Map(
    (request.pathParams ?? []).filter((p) => p.enabled && p.key).map((p) => [p.key, p.value]),
  );

  return (
    <div
      className={cn('relative min-w-0 flex-1', className)}
      onMouseLeave={scheduleHide}
      onMouseEnter={cancelHide}
    >
      {/* Highlight layer — metrics must match the input exactly */}
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center overflow-x-hidden whitespace-pre rounded-md border border-transparent px-2.5 font-mono text-xs"
      >
        {parts.map((part, i) => {
          const m = part.match(TOKEN_MATCH);
          if (m) {
            return (
              <span key={i} className={variableClass(m[1]!, vars)}>
                {part}
              </span>
            );
          }
          // `:name` is only a path variable before the query string starts
          if (PATH_TOKEN_MATCH.test(part) && offsets[i]! < pathEnd) {
            return (
              <span key={i} className={variableClass(part.slice(1), pathValues)}>
                {part}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>
      <input
        ref={inputRef}
        data-url-input
        value={request.url}
        placeholder="https://api.example.com/v1/users or {{baseUrl}}/users"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setHover(null);
          onChange(e.target.value);
          updateSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onBlur={() => setTimeout(() => setSuggest(null), 150)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (onImportCurl && isCurlCommand(text)) {
            // parsed by the backend; the raw command never lands in the URL field
            e.preventDefault();
            void parseCurl(text).then((parsed) => {
              if (parsed) onImportCurl(parsed);
              else onChange(text.trim());
            });
          }
        }}
        onScroll={() => {
          syncScroll();
          setHover(null);
        }}
        onMouseMove={onMouseMove}
        onKeyDown={(e) => {
          if (suggest) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSuggest({ ...suggest, selected: (suggest.selected + 1) % suggest.items.length });
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSuggest({
                ...suggest,
                selected: (suggest.selected - 1 + suggest.items.length) % suggest.items.length,
              });
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              applySuggestion(suggest.items[suggest.selected]!);
              return;
            }
            if (e.key === 'Escape') {
              setSuggest(null);
              return;
            }
          }
          if (e.key === 'Enter') onEnter?.();
          if (e.key === 'Escape') setHover(null);
        }}
        className={cn(
          'relative h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 font-mono text-xs',
          'text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      />
      {hover && !suggest && (
        <VariableHoverCard
          request={request}
          name={hover.name}
          style={{ left: Math.max(0, hover.left - 8) }}
          onEditingChange={(editing) => {
            pinnedRef.current = editing;
            if (editing) cancelHide();
          }}
          onClose={() => {
            pinnedRef.current = false;
            setHover(null);
          }}
        />
      )}
      {suggest && (
        <div
          className="absolute top-full z-50 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
          style={{ left: Math.min(suggest.left, 400) }}
        >
          {suggest.items.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keep input focus
                applySuggestion(s);
              }}
              onMouseEnter={() => setSuggest({ ...suggest, selected: i })}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-left',
                i === suggest.selected && 'bg-accent',
              )}
            >
              <span className="shrink-0 font-mono text-xs font-semibold text-primary">
                {'{{'}
                {s.name}
                {'}}'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {s.secret ? '••••••••' : s.value}
              </span>
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                {s.scopeLabel}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
