import * as React from 'react';
import { listen } from '@/platform/tauri';

export interface DownloadProgress {
  downloaded: number;
  /** total bytes, when GitHub reports the size */
  total: number | null;
}

/** Live download progress of the update while `active` is true. */
export function useUpdateProgress(active: boolean): DownloadProgress | null {
  const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
  React.useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    let unlisten: (() => void) | undefined;
    let alive = true;
    void listen<DownloadProgress>('update-progress', (p) => alive && setProgress(p)).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [active]);
  return progress;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s} sec left`;
}

/** Progress bar with downloaded / total size, percentage and time remaining. */
export function UpdateProgressBar({
  progress,
  fallbackTotal,
  restarting = false,
}: {
  progress: DownloadProgress | null;
  /** download finished and the app is about to restart into the new version */
  restarting?: boolean;
  /** asset size from the release, used when the download doesn't report one */
  fallbackTotal?: number;
}) {
  const downloaded = progress?.downloaded ?? 0;
  const total = progress?.total ?? (fallbackTotal && fallbackTotal > 0 ? fallbackTotal : null);
  const done = restarting || (total !== null && downloaded >= total);
  const percent = restarting
    ? 100
    : total
      ? Math.min(100, Math.floor((downloaded / total) * 100))
      : null;

  // Smoothed download speed for the time-remaining estimate.
  const sample = React.useRef<{ t: number; bytes: number; speed: number } | null>(null);
  const [eta, setEta] = React.useState<number | null>(null);
  React.useEffect(() => {
    const now = performance.now();
    const prev = sample.current;
    if (!prev || downloaded < prev.bytes) {
      sample.current = { t: now, bytes: downloaded, speed: 0 };
      setEta(null);
      return;
    }
    const dt = (now - prev.t) / 1000;
    if (dt < 0.25) return;
    const instant = (downloaded - prev.bytes) / dt;
    const speed = prev.speed ? prev.speed * 0.7 + instant * 0.3 : instant;
    sample.current = { t: now, bytes: downloaded, speed };
    setEta(total && speed > 0 ? (total - downloaded) / speed : null);
  }, [downloaded, total]);

  const status = restarting
    ? 'Restarting Zorvilo…'
    : done
    ? 'Installing…'
    : total
      ? `${formatBytes(downloaded)} of ${formatBytes(total)} · ${formatBytes(total - downloaded)} remaining`
      : downloaded > 0
        ? `${formatBytes(downloaded)} downloaded`
        : 'Starting download…';

  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        {percent !== null ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate tabular-nums">{status}</span>
        <span className="shrink-0 tabular-nums">
          {!done && eta !== null && `${formatDuration(eta)} · `}
          {percent !== null && <span className="font-medium text-foreground">{percent}%</span>}
        </span>
      </div>
    </div>
  );
}
