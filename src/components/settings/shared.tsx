import * as React from 'react';
import { cn } from '@/lib/utils';

export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 shrink-0">
        <div className="text-xs">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Pane({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-b pb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SubHeading({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div
      className={cn(
        'pt-1 text-[11px] font-semibold uppercase tracking-wide',
        danger ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}
