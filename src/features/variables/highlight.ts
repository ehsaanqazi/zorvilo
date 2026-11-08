import { isDynamicVariable } from './resolve';

/** `{{var}}` token — the capture group is the bare name. */
export const TOKEN_SPLIT = /(\{\{\s*\$?[\w.-]+\s*\}\})/g;
export const TOKEN_MATCH = /^\{\{\s*(\$?[\w.-]+)\s*\}\}$/;

/**
 * One rule for every place a `{{variable}}` is rendered (URL bar, params,
 * headers, cookies, form bodies): blue when it resolves to a non-empty value,
 * red when it doesn't — colour alone, no underline, so an unset variable is
 * obvious at a glance without extra decoration.
 *
 * "Unset" covers both undefined and defined-but-empty, since either way the
 * request would go out with nothing substituted in.
 */
export function variableClass(name: string, vars: Map<string, string>): string {
  // Dynamic `$` variables are generated at send time — always "set".
  const set = isDynamicVariable(name) || !!vars.get(name);
  return set
    ? 'font-semibold text-blue-600 dark:text-blue-400'
    : 'font-semibold text-red-600 dark:text-red-400';
}
