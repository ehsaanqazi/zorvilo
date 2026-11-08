import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped as typeof wrapped & { cancel: () => void };
}

/** Case-insensitive substring match used across search surfaces. */
export function matches(haystack: string | undefined | null, query: string): boolean {
  if (!query) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

/**
 * "Download" a blob: shows the native Save dialog and writes the file via the
 * backend. Resolves true when saved, false when the user cancelled.
 */
export async function downloadBlob(blob: Blob, fileName: string): Promise<boolean> {
  const { invoke } = await import('@/platform/tauri');
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  try {
    return await invoke<boolean>('save_file', { suggestedName: fileName, base64 });
  } catch (err) {
    const { toast } = await import('@/store/ui');
    toast('error', 'Could not save the file', err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function tryFormatJson(text: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch {
    return text;
  }
}

export function isJsonContentType(ct: string): boolean {
  return /json|\+json/i.test(ct);
}

export function statusColorClass(status: number): string {
  if (status === 0) return 'text-muted-foreground';
  if (status < 300) return 'text-emerald-600 dark:text-emerald-400';
  if (status < 400) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/** Short label + color for a request row/tab, protocol-aware. */
export function requestBadge(request: { protocol?: string; method: string }): {
  label: string;
  className: string;
} {
  switch (request.protocol) {
    case 'graphql':
      return { label: 'GQL', className: 'text-pink-600 dark:text-pink-400' };
    case 'ws':
      return { label: 'WS', className: 'text-cyan-600 dark:text-cyan-400' };
    case 'socketio':
      return { label: 'IO', className: 'text-teal-600 dark:text-teal-400' };
    default:
      return {
        label: request.method === 'DELETE' ? 'DEL' : request.method,
        className: methodColorClass(request.method),
      };
  }
}

export function methodColorClass(method: string): string {
  switch (method) {
    case 'GET':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'POST':
      return 'text-amber-600 dark:text-amber-500';
    case 'PUT':
      return 'text-blue-600 dark:text-blue-400';
    case 'PATCH':
      return 'text-violet-600 dark:text-violet-400';
    case 'DELETE':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}
