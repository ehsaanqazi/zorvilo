import type { KeyValue } from '@/types/models';
import { newKeyValue } from '@/lib/factories';
import { splitUrl } from './urlSync';

/**
 * Path variables (Postman's `:name` segments). The URL owns the key list —
 * typing `/users/:id` creates an `id` row; removing it from the URL drops the
 * row. Only the value is editable in the table.
 */

/** `:name` occupying a whole path segment, ignoring `::` and `{{vars}}`. */
const PATH_PARAM = /(^|\/):([A-Za-z_][\w-]*)/g;
/** `{name}` placeholders — accepted on input (OpenAPI style), never emitted. */
const BRACE_PARAM = /\{([A-Za-z_][\w-]*)\}/g;
const VAR_TOKEN = /\{\{\s*\$?[\w.-]+\s*\}\}/g;

/** Blank out {{variable}} tokens so their contents never look like placeholders. */
function maskVars(text: string): string {
  return text.replace(VAR_TOKEN, (m) => ' '.repeat(m.length));
}

/** Placeholder names found in the URL's path, in order, without duplicates. */
export function pathParamNames(url: string): string[] {
  const path = maskVars(splitUrl(url).base);
  const names: string[] = [];
  for (const re of [PATH_PARAM, BRACE_PARAM]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) {
      const name = m[m.length - 1]!;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Reconcile the path-variable rows with the placeholders in the URL: rows for
 * names still present keep their value/description, new names get a blank row,
 * and rows whose placeholder is gone are dropped.
 */
export function pathParamsFromUrl(url: string, existing: KeyValue[]): KeyValue[] {
  const names = pathParamNames(url);
  const byKey = new Map(existing.map((p) => [p.key, p]));
  // Rows whose key isn't in the URL yet are matched positionally, so a rename
  // driven from the table keeps the value that was already typed.
  const unmatched = existing.filter((p) => !names.includes(p.key));
  let spare = 0;
  return names.map((name) => {
    const prev = byKey.get(name) ?? unmatched[spare++];
    return prev ? { ...prev, key: name } : newKeyValue({ key: name, enabled: true });
  });
}

/**
 * Rename a placeholder in the URL, so editing a key in the Path Variables
 * table rewrites the `:old` segment to `:new` (and `{old}` to `{new}`).
 */
export function renamePathParamInUrl(url: string, from: string, to: string): string {
  if (!from || !to || from === to) return url;
  const { base, query } = splitUrl(url);
  const masked = maskVars(base);
  let out = '';
  let last = 0;
  for (const re of [
    new RegExp(`(^|/):${escapeRegExp(from)}(?![\\w-])`, 'g'),
    new RegExp(`\\{${escapeRegExp(from)}\\}`, 'g'),
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      if (m.index < last) continue;
      const isColon = m[0].includes(':');
      const lead = isColon ? (m[1]?.length ?? 0) : 0;
      out += base.slice(last, m.index + lead) + (isColon ? `:${to}` : `{${to}}`);
      last = m.index + m[0].length;
    }
  }
  out += base.slice(last);
  return query ? `${out}?${query}` : out;
}

/** Append a new `:name` segment to the URL's path. */
export function appendPathParamToUrl(url: string, name: string): string {
  if (!name) return url;
  const { base, query } = splitUrl(url);
  const next = `${base.replace(/\/+$/, '')}/:${name}`;
  return query ? `${next}?${query}` : next;
}

/** Remove a `:name` / `{name}` placeholder (and its leading `/`) from the URL. */
export function removePathParamFromUrl(url: string, name: string): string {
  if (!name) return url;
  const { base, query } = splitUrl(url);
  const next = base
    .replace(new RegExp(`/:${escapeRegExp(name)}(?![\\w-])`, 'g'), '')
    .replace(new RegExp(`/?\\{${escapeRegExp(name)}\\}`, 'g'), '');
  return query ? `${next}?${query}` : next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace `:name` / `{name}` placeholders with their path-variable values. */
export function urlFromPathParams(url: string, pathParams: KeyValue[]): string {
  const values = new Map(
    pathParams.filter((p) => p.enabled && p.key).map((p) => [p.key, p.value]),
  );
  if (values.size === 0) return url;

  const { base, query } = splitUrl(url);
  // Substitute only in the path — a `:name` in the query string is literal.
  const masked = maskVars(base);
  let out = '';
  let last = 0;
  for (const re of [PATH_PARAM, BRACE_PARAM]) {
    re.lastIndex = 0;
  }
  const matches: { start: number; end: number; name: string }[] = [];
  for (const re of [PATH_PARAM, BRACE_PARAM]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const name = m[m.length - 1]!;
      // keep the leading `/` (or start) that PATH_PARAM captured
      const lead = re === PATH_PARAM ? (m[1]?.length ?? 0) : 0;
      matches.push({ start: m.index + lead, end: m.index + m[0].length, name });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  for (const match of matches) {
    if (match.start < last) continue;
    const value = values.get(match.name);
    if (value === undefined) continue;
    out += base.slice(last, match.start) + value;
    last = match.end;
  }
  out += base.slice(last);
  return query ? `${out}?${query}` : out;
}
