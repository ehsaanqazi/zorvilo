import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-popover p-3 shadow-lg',
            t.kind === 'error' && 'border-destructive/50',
          )}
        >
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />}
          {t.kind === 'error' && <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{t.title}</div>
            {t.detail && (
              <div className="mt-0.5 break-words text-xs text-muted-foreground">{t.detail}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-50 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
