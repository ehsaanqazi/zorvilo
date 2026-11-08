import type {
  ApiRequest,
  AppSettings,
  AuthConfig,
  BodyConfig,
  Collection,
  Environment,
  Folder,
  GitMeta,
  KeyValue,
  TabState,
  UiState,
  Variable,
  Workspace,
} from '@/types/models';
import { now, uid } from './utils';

export function newKeyValue(partial: Partial<KeyValue> = {}): KeyValue {
  return { id: uid(), key: '', value: '', enabled: true, description: '', ...partial };
}

export function newVariable(partial: Partial<Variable> = {}): Variable {
  return { id: uid(), key: '', value: '', enabled: true, secret: false, ...partial };
}

export function newAuthConfig(partial: Partial<AuthConfig> = {}): AuthConfig {
  return {
    type: 'none',
    apiKey: { key: '', value: '', addTo: 'header' },
    bearer: { token: '', prefix: 'Bearer' },
    basic: { username: '', password: '' },
    digest: { username: '', password: '' },
    oauth2: {
      grantType: 'client_credentials',
      authUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      accessToken: '',
    },
    jwt: { secret: '', payload: '{\n  "sub": "user"\n}', algorithm: 'HS256', addTo: 'header' },
    aws: { accessKey: '', secretKey: '', region: 'us-east-1', service: 'execute-api' },
    ...partial,
  };
}

export function newBodyConfig(partial: Partial<BodyConfig> = {}): BodyConfig {
  return {
    type: 'none',
    content: '',
    graphql: { query: '', variables: '{}' },
    formUrlEncoded: [],
    multipart: [],
    binary: null,
    ...partial,
  };
}

export function newRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  const ts = now();
  return {
    id: uid(),
    workspaceId: '',
    collectionId: '',
    folderId: null,
    name: 'New Request',
    description: '',
    protocol: 'http',
    method: 'GET',
    url: '',
    pathParams: [],
    params: [],
    headers: [],
    cookies: [],
    auth: newAuthConfig(),
    body: newBodyConfig(),
    preRequestScript: '',
    testScript: '',
    variables: [],
    settings: { timeoutMs: 0, followRedirects: true, maxRedirects: 10, verifySsl: true },
    tags: [],
    favorite: false,
    sortOrder: ts,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

/** Sensible presets for the "+" menu's request types. */
export function protocolPreset(protocol: ApiRequest['protocol']): Partial<ApiRequest> {
  switch (protocol) {
    case 'graphql':
      return {
        protocol,
        name: 'GraphQL Request',
        method: 'POST',
        body: newBodyConfig({ type: 'graphql' }),
      };
    case 'ws':
      return { protocol, name: 'WebSocket', url: 'wss://' };
    case 'socketio':
      return { protocol, name: 'Socket.IO', url: 'https://' };
    default:
      return { protocol: 'http' };
  }
}

export function newCollection(partial: Partial<Collection> = {}): Collection {
  const ts = now();
  return {
    id: uid(),
    workspaceId: '',
    name: 'New Collection',
    description: '',
    variables: [],
    auth: newAuthConfig(),
    preRequestScript: '',
    testScript: '',
    sortOrder: ts,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function newFolder(partial: Partial<Folder> = {}): Folder {
  const ts = now();
  return {
    id: uid(),
    workspaceId: '',
    collectionId: '',
    parentId: null,
    name: 'New Folder',
    description: '',
    sortOrder: ts,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function newWorkspace(partial: Partial<Workspace> = {}): Workspace {
  const ts = now();
  return {
    id: uid(),
    name: 'My Workspace',
    description: '',
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function newEnvironment(partial: Partial<Environment> = {}): Environment {
  const ts = now();
  return {
    id: uid(),
    workspaceId: '',
    name: 'New Environment',
    variables: [],
    isActive: false,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function newTab(partial: Partial<TabState> = {}): TabState {
  const ts = now();
  return {
    id: uid(),
    workspaceId: '',
    kind: 'request',
    requestId: '',
    draft: null,
    pinned: false,
    sortOrder: ts,
    createdAt: ts,
    ...partial,
  };
}

export function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    fontSize: 13,
    editorFontSize: 13,
    requestTimeoutMs: 30_000,
    defaultHeaders: [],
    jsonIndent: 2,
    wordWrap: true,
    proxy: { enabled: false, url: '', username: '', noProxy: '' },
    tls: { verify: true, caCertPath: '', clientIdentityPath: '' },
    cookiesEnabled: true,
    autoSyncEnabled: false,
    autoSyncIntervalMin: 5,
    maxHistoryEntries: 1000,
    closeDraftBehavior: 'ask',
    updateRepo: 'ehsaanqazi/zorvilo',
  };
}

export function defaultUiState(workspaceId = ''): UiState {
  return {
    activeWorkspaceId: workspaceId,
    sidebarSection: 'collections',
    sidebarCollapsed: false,
    sidebarWidth: 280,
    treePanelWidth: 280,
    responseSplit: 0.5,
    requestLayout: 'vertical',
    activeTabId: null,
    splitTabId: null,
    splitRatio: 0.5,
    expandedNodes: [],
    searchHistory: [],
  };
}

/** One shared repository for the whole app — every workspace syncs into it. */
export const GLOBAL_GIT_META_ID = 'git-global';

export function newGitMeta(partial: Partial<GitMeta> = {}): GitMeta {
  return {
    id: GLOBAL_GIT_META_ID,
    workspaceId: '',
    repoUrl: '',
    dir: '',
    branch: 'main',
    username: '',
    token: '',
    // filled from the system `git config` (user.name / user.email) when available
    authorName: '',
    authorEmail: '',
    lastSyncAt: 0,
    createdAt: now(),
    ...partial,
  };
}
