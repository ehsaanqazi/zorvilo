import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---- Tooltip ---- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={4}
          className="z-50 rounded bg-[#303030] px-2 py-1 text-[11px] font-medium text-white shadow-md"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ---- Switch ---- */

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-send data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

/* ---- Checkbox ---- */

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-3.5 shrink-0 rounded-sm border border-muted-foreground/50 transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground data-[state=checked]:text-background',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* ---- Badge ---- */

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'outline' | 'secondary' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
        variant === 'default' && 'bg-primary/15 text-primary',
        variant === 'secondary' && 'bg-secondary text-secondary-foreground',
        variant === 'outline' && 'border text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/* ---- Kbd ---- */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/* ---- Simple inner tab strip (not the top-level request tabs) ---- */

export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  className,
  labels,
  counts,
  dots,
  right,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  className?: string;
  labels?: Partial<Record<T, string>>;
  counts?: Partial<Record<T, number>>;
  /** Tabs that hold content but have nothing meaningful to count (e.g. a body payload). */
  dots?: Partial<Record<T, boolean>>;
  /** content aligned to the right end of the strip (e.g. response status) */
  right?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-4 border-b px-4', className)}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            '-mb-px flex h-9 items-center gap-1 whitespace-nowrap border-b-2 px-0.5 text-xs capitalize transition-colors',
            value === tab
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {labels?.[tab] ?? tab}
          {counts?.[tab] ? (
            <span className="text-xs font-normal text-[#007f31] dark:text-[#6bdd9a]">
              ({counts[tab]})
            </span>
          ) : dots?.[tab] ? (
            <span className="size-1.5 rounded-full bg-[#0cbb52]" aria-label="has content" />
          ) : null}
        </button>
      ))}
      {right && <div className="ml-auto flex min-w-0 items-center gap-3 pl-2">{right}</div>}
    </div>
  );
}

/* ---- Empty state ---- */

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <div className="text-muted-foreground/50 [&_svg]:size-8">{icon}</div>}
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      {children && <div className="text-xs text-muted-foreground/70">{children}</div>}
    </div>
  );
}
