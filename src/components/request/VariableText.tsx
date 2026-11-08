import * as React from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import type { ApiRequest } from '@/types/models';
import { isDynamicVariable } from '@/features/variables/resolve';
import { lookupVariable, quickAddVariable, updateVariableValue } from '@/features/variables/lookup';
import { TOKEN_SPLIT, TOKEN_MATCH, variableClass } from '@/features/variables/highlight';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';


/**
 * Hover card for a `{{variable}}`: shows the resolved value and its scope, and
 * lets you edit that value in place (Edit turns into Save). Undefined
 * variables get the quick-add form instead.
 */
export function VariableHoverCard({
  request,
  name,
  style,
  className,
  onClose,
  onEditingChange,
}: {
  request: ApiRequest | null;
  name: string;
  style?: React.CSSProperties;
  className?: string;
  onClose: () => void;
  /** told when editing starts/stops so the owner can pin the card open */
  onEditingChange?: (editing: boolean) => void;
}) {
  const info = lookupVariable(request, name);
  const [editing, setEditingState] = React.useState(false);
  const [value, setValue] = React.useState('');
  const setEditing = (next: boolean) => {
    setEditingState(next);
    onEditingChange?.(next);
  };
  // never leave the owner pinned open if the card goes away mid-edit
  const notifyRef = React.useRef(onEditingChange);
  notifyRef.current = onEditingChange;
  React.useEffect(() => () => notifyRef.current?.(false), []);
  // Dynamic `$` variables are generated at send time — nothing to edit.
  const editable = info.found && info.scope !== null && !isDynamicVariable(name);

  const beginEdit = () => {
    setValue(info.value);
    setEditing(true);
  };

  const save = () => {
    if (info.found) updateVariableValue(request, name, value);
    else quickAddVariable(name, value);
    setEditing(false);
    onClose();
  };

  return (
    <div
      style={style}
      className={cn(
        'absolute top-full z-50 mt-1 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs font-semibold text-primary">
          {'{{'}
          {name}
          {'}}'}
        </span>
        {info.found && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {info.scopeLabel}
          </span>
        )}
      </div>

      {info.found && !editing && (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="min-w-0 flex-1 break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-xs">
            {info.secret ? (
              '••••••••'
            ) : (
              info.value || <span className="text-muted-foreground">(empty)</span>
            )}
          </div>
          {editable && (
            <Button size="sm" variant="outline" className="shrink-0" onClick={beginEdit}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      )}

      {info.found && editing && (
        <div className="mt-2 flex items-center gap-1.5">
          <Input
            autoFocus
            value={value}
            placeholder="Value"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-7 min-w-0 flex-1 font-mono text-xs"
          />
          <Button size="sm" className="shrink-0" onClick={save}>
            <Check /> Save
          </Button>
        </div>
      )}

      {!info.found && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            Not defined in the current scope. Add it now:
          </p>
          <div className="flex gap-1.5">
            <Input
              autoFocus={false}
              value={value}
              placeholder="Value"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
              className="h-7 flex-1 font-mono text-xs"
            />
            <Button size="sm" onClick={save}>
              <Plus /> Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Text input that highlights `{{variables}}` (colored overlay behind a
 * transparent-text input) and opens a hover card for the token under the
 * pointer. Used by header/param/cookie rows; the URL bar has its own richer
 * variant with autocomplete.
 */
export function VariableInput({
  request,
  value,
  onChange,
  placeholder,
  className,
  vars,
  onKeyDown,
}: {
  request: ApiRequest | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** resolved variables, so set/unset can be colored differently */
  vars: Map<string, string>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const charWidthRef = React.useRef(0);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = React.useState<{ name: string; left: number } | null>(null);
  /** while the card is in edit mode it stays open regardless of the pointer */
  const pinnedRef = React.useRef(false);

  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  React.useEffect(syncScroll, [value]);

  const measureCharWidth = (): number => {
    if (charWidthRef.current > 0) return charWidthRef.current;
    const input = inputRef.current;
    if (!input) return 7;
    const ctx = document.createElement('canvas').getContext('2d');
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
  React.useEffect(() => cancelHide, []);

  const onMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input || pinnedRef.current || !value.includes('{{')) return;
    const charW = measureCharWidth();
    const rect = input.getBoundingClientRect();
    // px-2 padding + 1px border on these compact rows
    const textX = e.clientX - rect.left - 9 + input.scrollLeft;
    const charIndex = Math.floor(textX / charW);
    if (charIndex < 0) {
      scheduleHide();
      return;
    }
    const scan = new RegExp(TOKEN_SPLIT.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = scan.exec(value)) !== null) {
      const start = match.index;
      if (charIndex >= start && charIndex < start + match[0].length) {
        const name = match[0].match(TOKEN_MATCH)?.[1];
        if (!name) break;
        cancelHide();
        const left = 9 + start * charW - input.scrollLeft;
        setHover((prev) =>
          prev && prev.name === name && Math.abs(prev.left - left) < 1 ? prev : { name, left },
        );
        return;
      }
    }
    scheduleHide();
  };

  const parts = value.split(TOKEN_SPLIT);

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
        className="pointer-events-none absolute inset-0 flex items-center overflow-x-hidden whitespace-pre rounded-md border border-transparent px-2 font-mono text-xs"
      >
        {parts.map((part, i) => {
          const m = part.match(TOKEN_MATCH);
          if (!m) return <span key={i}>{part}</span>;
          return (
            <span key={i} className={variableClass(m[1]!, vars)}>
              {part}
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setHover(null);
          onChange(e.target.value);
        }}
        onScroll={() => {
          syncScroll();
          setHover(null);
        }}
        onMouseMove={onMouseMove}
        onKeyDown={onKeyDown}
        className={cn(
          'relative h-7 w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs',
          'text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent',
          'placeholder:text-muted-foreground focus-visible:border-input focus-visible:outline-none',
        )}
      />
      {hover && (
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
    </div>
  );
}
