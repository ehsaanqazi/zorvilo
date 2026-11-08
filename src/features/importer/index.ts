import type { ApiRequest, Collection, Environment, Folder } from '@/types/models';
import { invoke } from '@/platform/tauri';

/** Importers run in the Rust backend; this module is their typed front door. */

export type ParsedImport =
  | { kind: 'curl'; request: ApiRequest; suggestedName: string }
  | {
      kind: 'postman-collection';
      version: string;
      collection: Collection;
      folders: Folder[];
      requests: ApiRequest[];
      warnings: string[];
    }
  | { kind: 'postman-environment'; environment: Environment }
  | {
      kind: 'workspace-bundle';
      collections: Collection[];
      folders: Folder[];
      requests: ApiRequest[];
      environments: Environment[];
      warnings: string[];
      failed: string[];
    };

/** Detect and parse pasted text / file content (Postman v2.0/2.1, environments, bundles, cURL). */
export function parseImport(text: string, workspaceId: string): Promise<ParsedImport> {
  return invoke<ParsedImport>('import_parse', { text, workspaceId });
}

/** Cheap synchronous check used on paste before asking the backend to parse. */
export function isCurlCommand(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

export interface ParsedCurl {
  /** fields of the parsed request to apply to a tab/draft */
  patch: Partial<ApiRequest>;
  suggestedName: string;
}

/** Parse a cURL command into request fields (null when it isn't one). */
export async function parseCurl(text: string): Promise<ParsedCurl | null> {
  const parsed = await invoke<{ request: ApiRequest; suggestedName: string } | null>('parse_curl', { text });
  if (!parsed) return null;
  const r = parsed.request;
  return {
    suggestedName: parsed.suggestedName,
    patch: {
      method: r.method,
      url: r.url,
      params: r.params,
      pathParams: r.pathParams,
      headers: r.headers,
      cookies: r.cookies,
      auth: r.auth,
      body: r.body,
    },
  };
}

/** Parse a Postman environment file. */
export async function importPostmanEnvironment(text: string, workspaceId: string): Promise<Environment> {
  const parsed = await parseImport(text, workspaceId);
  if (parsed.kind !== 'postman-environment') {
    throw new Error('This file is not a Postman environment.');
  }
  return parsed.environment;
}
