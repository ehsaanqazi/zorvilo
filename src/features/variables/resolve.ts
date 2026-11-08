import type { ApiRequest, Collection, Environment, Variable } from '@/types/models';

/**
 * Variable precedence (highest wins):
 *   request > collection > workspace (active environment) > global
 */
export function buildVariableMap(input: {
  request?: ApiRequest | null;
  collection?: Collection | null;
  environment?: Environment | null;
  globals?: Variable[];
}): Map<string, string> {
  const map = new Map<string, string>();
  const layers: (Variable[] | undefined)[] = [
    input.globals,
    input.environment?.variables,
    input.collection?.variables,
    input.request?.variables,
  ];
  for (const layer of layers) {
    if (!layer) continue;
    for (const v of layer) {
      if (v.enabled && v.key) map.set(v.key, v.value);
    }
  }
  return map;
}

const VAR_PATTERN = /\{\{\s*(\$?[\w.-]+)\s*\}\}/g;
const MAX_DEPTH = 8;

/**
 * Dynamic variables — generated fresh at resolve time (Postman-style `$` names).
 */
export const DYNAMIC_VARIABLES: Record<string, () => string> = {
  $uuid: () => crypto.randomUUID(),
  $guid: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $isoDate: () => new Date().toISOString().slice(0, 10),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
  $randomBoolean: () => String(Math.random() < 0.5),
  $randomAlphaNumeric: () => Math.random().toString(36).slice(2, 12),
};

export function isDynamicVariable(name: string): boolean {
  return name.startsWith('$') && name in DYNAMIC_VARIABLES;
}

/** Replace {{name}} placeholders; supports nested references up to a fixed depth. */
export function resolveTemplate(text: string, vars: Map<string, string>): string {
  if (!text || !text.includes('{{')) return text;
  let out = text;
  for (let i = 0; i < MAX_DEPTH; i++) {
    let replaced = false;
    out = out.replace(VAR_PATTERN, (match, name: string) => {
      if (isDynamicVariable(name)) {
        replaced = true;
        return DYNAMIC_VARIABLES[name]!();
      }
      const value = vars.get(name);
      if (value === undefined) return match;
      replaced = true;
      return value;
    });
    if (!replaced || !out.includes('{{')) break;
  }
  return out;
}

/** Names referenced in a template that have no value in the current scope chain. */
export function findUnresolved(text: string, vars: Map<string, string>): string[] {
  const missing = new Set<string>();
  for (const match of text.matchAll(VAR_PATTERN)) {
    const name = match[1]!;
    if (!vars.has(name) && !isDynamicVariable(name)) missing.add(name);
  }
  return [...missing];
}

/** Deep-resolve all string fields of a request that can carry {{variables}}. */
export function resolveRequest(request: ApiRequest, vars: Map<string, string>): ApiRequest {
  const r = (s: string) => resolveTemplate(s, vars);
  const kv = <T extends { key: string; value: string }>(items: T[]): T[] =>
    items.map((item) => ({ ...item, key: r(item.key), value: r(item.value) }));

  return {
    ...request,
    url: r(request.url),
    pathParams: kv(request.pathParams ?? []),
    params: kv(request.params),
    headers: kv(request.headers),
    cookies: kv(request.cookies),
    auth: {
      ...request.auth,
      apiKey: {
        ...request.auth.apiKey,
        key: r(request.auth.apiKey.key),
        value: r(request.auth.apiKey.value),
      },
      bearer: { ...request.auth.bearer, token: r(request.auth.bearer.token) },
      basic: {
        username: r(request.auth.basic.username),
        password: r(request.auth.basic.password),
      },
      digest: {
        username: r(request.auth.digest.username),
        password: r(request.auth.digest.password),
      },
      jwt: {
        ...request.auth.jwt,
        secret: r(request.auth.jwt.secret),
        payload: r(request.auth.jwt.payload),
      },
    },
    body: {
      ...request.body,
      content: r(request.body.content),
      graphql: {
        query: r(request.body.graphql.query),
        variables: r(request.body.graphql.variables),
      },
      formUrlEncoded: kv(request.body.formUrlEncoded),
      multipart: request.body.multipart.map((item) => ({
        ...item,
        key: r(item.key),
        value: item.kind === 'text' ? r(item.value) : item.value,
      })),
    },
  };
}
