/** Core domain models. Persisted by the Rust backend (SQLite + OS keychain for secrets). */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

/** What kind of API a request talks to. */
export type Protocol = 'http' | 'graphql' | 'ws' | 'socketio';

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface Variable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export type VariableScope = 'global' | 'workspace' | 'collection' | 'request';

export type AuthType =
  'none' | 'inherit' | 'apiKey' | 'bearer' | 'basic' | 'digest' | 'oauth2' | 'jwt' | 'aws';

export interface AuthConfig {
  type: AuthType;
  apiKey: { key: string; value: string; addTo: 'header' | 'query' };
  bearer: { token: string; prefix: string };
  basic: { username: string; password: string };
  digest: { username: string; password: string };
  /** Token exchange runs in the Rust backend ("Get new access token"). */
  oauth2: {
    grantType: 'authorization_code' | 'client_credentials' | 'password';
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
    accessToken: string;
    refreshToken?: string;
    /** resource-owner credentials for the password grant */
    username?: string;
    password?: string;
    /** ms since epoch, 0/undefined = unknown */
    expiresAt?: number;
  };
  jwt: { secret: string; payload: string; algorithm: 'HS256'; addTo: 'header' | 'query' };
  /** AWS Signature Version 4 — signed by the Rust HTTP engine at send time. */
  aws: { accessKey: string; secretKey: string; region: string; service: string };
}

export type BodyType =
  | 'none'
  | 'json'
  | 'raw'
  | 'xml'
  | 'html'
  | 'text'
  | 'graphql'
  | 'form-urlencoded'
  | 'multipart'
  | 'binary';

export const BODY_TYPES: BodyType[] = [
  'none',
  'json',
  'raw',
  'xml',
  'html',
  'text',
  'graphql',
  'form-urlencoded',
  'multipart',
  'binary',
];

export interface FormDataFile {
  fileName: string;
  contentType?: string;
  /** base64-encoded file content (kept small; large files are rejected on pick) */
  fileBase64: string;
}

export interface FormDataItem extends KeyValue {
  kind: 'text' | 'file';
  /** Attached files for a file-kind row. Supports multiple files per key. */
  files?: FormDataFile[];
  /** @deprecated legacy single-file fields — read as a fallback when `files` is absent */
  fileName?: string;
  contentType?: string;
  fileBase64?: string;
}

/** Normalize a form-data item's attached files, folding legacy single-file fields into the array. */
export function formDataFiles(item: FormDataItem): FormDataFile[] {
  if (item.files && item.files.length) return item.files;
  if (item.fileBase64 !== undefined) {
    return [
      {
        fileName: item.fileName ?? 'file',
        contentType: item.contentType,
        fileBase64: item.fileBase64,
      },
    ];
  }
  return [];
}

export interface BinaryBody {
  fileName: string;
  contentType: string;
  base64: string;
}

export interface BodyConfig {
  type: BodyType;
  /** json / raw / xml / html / text content */
  content: string;
  graphql: { query: string; variables: string };
  formUrlEncoded: KeyValue[];
  multipart: FormDataItem[];
  binary: BinaryBody | null;
}

export interface RequestSettings {
  /** 0 = use the global default from app settings */
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  /** verify the server's TLS certificate (also requires the global TLS setting) */
  verifySsl: boolean;
}

export interface ApiRequest {
  id: string;
  workspaceId: string;
  /** empty string when the request only lives in a tab draft */
  collectionId: string;
  folderId: string | null;
  name: string;
  description: string;
  protocol: Protocol;
  method: HttpMethod;
  url: string;
  /** Values substituted into {name} or :name path placeholders before sending. */
  pathParams: KeyValue[];
  params: KeyValue[];
  headers: KeyValue[];
  cookies: KeyValue[];
  auth: AuthConfig;
  body: BodyConfig;
  /** Postman-compatible `pm` scripts, executed by the Rust script engine */
  preRequestScript: string;
  testScript: string;
  variables: Variable[];
  settings: RequestSettings;
  tags: string[];
  favorite: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  workspaceId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  variables: Variable[];
  /** collection-level auth — requests with auth type "inherit" use this */
  auth: AuthConfig;
  /** collection-level scripts (placeholder architecture, like request scripts) */
  preRequestScript: string;
  testScript: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  variables: Variable[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A standalone variable row (global scope lives in its own table). */
export interface ScopedVariable extends Variable {
  scope: VariableScope;
  /** workspace/collection/request id; '' for globals */
  ownerId: string;
}

/** One `pm.test(...)` outcome. */
export interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string | null;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyText: string;
  /** present for binary payloads (images, files) */
  bodyBase64: string | null;
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  timestamp: number;
  /** network / abort error message when the request failed before a response */
  error: string | null;
  /** final URL after redirects */
  finalUrl?: string;
  httpVersion?: string;
  /** non-fatal notices (e.g. TLS verification disabled, private-network target) */
  warnings?: string[];
}

export interface SavedResponse {
  id: string;
  workspaceId: string;
  requestId: string;
  requestName: string;
  name: string;
  method: HttpMethod;
  url: string;
  response: ResponseData;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  workspaceId: string;
  requestId: string | null;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  timestamp: number;
  favorite: boolean;
  /** full snapshot for replay */
  snapshot: ApiRequest;
}

export interface TabState {
  id: string;
  workspaceId: string;
  /** what this tab shows; requestId holds the collection id for collection tabs */
  kind: 'request' | 'collection';
  /** id of the persisted request; for drafts this matches draft.id */
  requestId: string;
  /** unsaved scratch request (not part of any collection yet) */
  draft: ApiRequest | null;
  pinned: boolean;
  sortOrder: number;
  createdAt: number;
}

export type ThemeMode = 'light' | 'dark' | 'dark-slate' | 'system';

export interface AppSettings {
  theme: ThemeMode;
  fontSize: number;
  editorFontSize: number;
  requestTimeoutMs: number;
  defaultHeaders: KeyValue[];
  jsonIndent: number;
  wordWrap: boolean;
  /** outbound HTTP(S)/SOCKS proxy used by the native HTTP engine */
  proxy: { enabled: boolean; url: string; username: string; noProxy: string };
  /** TLS verification and custom certificates (PEM paths on disk) */
  tls: { verify: boolean; caCertPath: string; clientIdentityPath: string };
  /** keep a cookie jar across requests (Set-Cookie is honoured) */
  cookiesEnabled: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
  maxHistoryEntries: number;
  /** what to do when closing an unsaved request tab */
  closeDraftBehavior: 'ask' | 'save' | 'discard';
  /** GitHub repository (owner/repo) whose releases provide app updates */
  updateRepo: string;
}

export interface UiState {
  activeWorkspaceId: string;
  sidebarSection: 'workspaces' | 'collections' | 'environments' | 'history' | 'trash';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  treePanelWidth: number;
  responseSplit: number;
  /** request/response arrangement: stacked (top/bottom) or side-by-side */
  requestLayout: 'vertical' | 'horizontal';
  activeTabId: string | null;
  /** second pane for side-by-side split view */
  splitTabId: string | null;
  splitRatio: number;
  expandedNodes: string[];
  searchHistory: string[];
}

export interface GitMeta {
  id: string;
  workspaceId: string;
  repoUrl: string;
  /** working tree location (managed by the backend; '' = default) */
  dir: string;
  branch: string;
  username: string;
  /** kept in the OS keychain by the backend, never in the database */
  token: string;
  authorName: string;
  authorEmail: string;
  lastSyncAt: number;
  createdAt: number;
}

/** Soft-deleted entity, restorable for 30 days. */
export interface TrashEntry {
  id: string;
  workspaceId: string;
  kind: 'collection' | 'folder' | 'request' | 'environment';
  name: string;
  deletedAt: number;
  payload: {
    collection?: Collection;
    folders?: Folder[];
    requests?: ApiRequest[];
    environment?: Environment;
  };
}
