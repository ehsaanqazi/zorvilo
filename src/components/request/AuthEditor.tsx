import * as React from 'react';
import { KeyRound } from 'lucide-react';
import type { AuthConfig, AuthType } from '@/types/models';
import { Button } from '@/components/ui/button';
import { useEnvironments } from '@/store/environments';
import { useSettings } from '@/store/settings';
import { toast } from '@/store/ui';
import { buildVariableMap, resolveTemplate } from '@/features/variables/resolve';
import { invoke } from '@/platform/tauri';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const AUTH_LABELS: Record<AuthType, string> = {
  inherit: 'Inherit from parent',
  none: 'No Auth',
  apiKey: 'API Key',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  digest: 'Digest Auth',
  oauth2: 'OAuth 2.0',
  jwt: 'JWT (HS256)',
  aws: 'AWS Signature',
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-md font-mono text-xs"
      />
    </label>
  );
}

export function AuthEditor({
  auth,
  onChange,
  allowInherit = false,
  inheritHint,
}: {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  /** requests can inherit from their collection; collections cannot */
  allowInherit?: boolean;
  inheritHint?: string;
}) {
  const set = (patch: Partial<AuthConfig>) => onChange({ ...auth, ...patch });

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Type</span>
        <Select value={auth.type} onValueChange={(type) => set({ type: type as AuthType })}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AUTH_LABELS) as AuthType[])
              .filter((t) => allowInherit || t !== 'inherit')
              .map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTH_LABELS[t]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>

      {auth.type === 'inherit' && (
        <p className="text-xs text-muted-foreground">
          {inheritHint ??
            'This request uses the auth configured on its collection (open the collection to change it).'}
        </p>
      )}

      {auth.type === 'apiKey' && (
        <>
          <Field label="Key" value={auth.apiKey.key} onChange={(key) => set({ apiKey: { ...auth.apiKey, key } })} placeholder="X-Api-Key" />
          <Field label="Value" value={auth.apiKey.value} onChange={(value) => set({ apiKey: { ...auth.apiKey, value } })} />
          <label className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-muted-foreground">Add to</span>
            <Select
              value={auth.apiKey.addTo}
              onValueChange={(addTo) => set({ apiKey: { ...auth.apiKey, addTo: addTo as 'header' | 'query' } })}
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query Params</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </>
      )}

      {auth.type === 'bearer' && (
        <>
          <Field label="Token" value={auth.bearer.token} onChange={(token) => set({ bearer: { ...auth.bearer, token } })} />
          <Field label="Prefix" value={auth.bearer.prefix} onChange={(prefix) => set({ bearer: { ...auth.bearer, prefix } })} placeholder="Bearer" />
        </>
      )}

      {auth.type === 'basic' && (
        <>
          <Field label="Username" value={auth.basic.username} onChange={(username) => set({ basic: { ...auth.basic, username } })} />
          <Field label="Password" type="password" value={auth.basic.password} onChange={(password) => set({ basic: { ...auth.basic, password } })} />
        </>
      )}

      {auth.type === 'digest' && (
        <>
          <Field label="Username" value={auth.digest.username} onChange={(username) => set({ digest: { ...auth.digest, username } })} />
          <Field label="Password" type="password" value={auth.digest.password} onChange={(password) => set({ digest: { ...auth.digest, password } })} />
          <p className="text-xs text-muted-foreground">
            Digest answers the server&apos;s 401 challenge automatically (MD5, MD5-sess,
            SHA-256).
          </p>
        </>
      )}

      {auth.type === 'jwt' && (
        <>
          <Field label="Secret" type="password" value={auth.jwt.secret} onChange={(secret) => set({ jwt: { ...auth.jwt, secret } })} />
          <label className="flex items-start gap-3">
            <span className="w-28 shrink-0 pt-1.5 text-xs text-muted-foreground">Payload (JSON)</span>
            <textarea
              value={auth.jwt.payload}
              onChange={(e) => set({ jwt: { ...auth.jwt, payload: e.target.value } })}
              className="h-24 max-w-md flex-1 rounded-md border border-input bg-transparent p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <p className="text-xs text-muted-foreground">Signed as HS256 at send time and attached as a Bearer token.</p>
        </>
      )}

      {auth.type === 'oauth2' && (
        <OAuth2Section auth={auth} onChange={(oauth2) => set({ oauth2 })} />
      )}

      {auth.type === 'aws' && (
        <>
          <Field label="Access key" value={auth.aws.accessKey} onChange={(accessKey) => set({ aws: { ...auth.aws, accessKey } })} />
          <Field label="Secret key" type="password" value={auth.aws.secretKey} onChange={(secretKey) => set({ aws: { ...auth.aws, secretKey } })} />
          <Field label="Region" value={auth.aws.region} onChange={(region) => set({ aws: { ...auth.aws, region } })} />
          <Field label="Service" value={auth.aws.service} onChange={(service) => set({ aws: { ...auth.aws, service } })} />
          <p className="text-xs text-muted-foreground">
            Requests are signed with AWS Signature Version 4 at send time.
          </p>
        </>
      )}

      {auth.type === 'none' && (
        <p className="text-xs text-muted-foreground">This request does not use authentication.</p>
      )}
    </div>
  );
}

const GRANT_LABELS: Record<AuthConfig['oauth2']['grantType'], string> = {
  authorization_code: 'Authorization Code (PKCE, opens browser)',
  client_credentials: 'Client Credentials',
  password: 'Password',
};

interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

/** OAuth 2.0 settings + "Get new access token" (the grant runs in the Rust backend). */
function OAuth2Section({
  auth,
  onChange,
}: {
  auth: AuthConfig;
  onChange: (oauth2: AuthConfig['oauth2']) => void;
}) {
  const o = auth.oauth2;
  const [busy, setBusy] = React.useState(false);
  const patch = (p: Partial<AuthConfig['oauth2']>) => onChange({ ...o, ...p });

  const getToken = async (refresh: boolean) => {
    // {{variables}} from the environment / globals are resolved before the exchange
    const { environments, globals } = useEnvironments.getState();
    const vars = buildVariableMap({ environment: environments.find((e) => e.isActive), globals });
    const r = (v: string | undefined) => resolveTemplate(v ?? '', vars);
    setBusy(true);
    try {
      const token = await invoke<TokenResponse>('oauth2_get_token', {
        auth: {
          grantType: o.grantType,
          authUrl: r(o.authUrl),
          tokenUrl: r(o.tokenUrl),
          clientId: r(o.clientId),
          clientSecret: r(o.clientSecret),
          scope: r(o.scope),
          username: r(o.username),
          password: r(o.password),
          refreshToken: o.refreshToken ?? '',
        },
        verifyTls: useSettings.getState().settings.tls.verify,
        refresh,
      });
      patch({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? o.refreshToken,
        expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : 0,
      });
      toast('success', refresh ? 'Access token refreshed' : 'Access token received');
    } catch (err) {
      toast('error', 'Token request failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const expired = !!o.expiresAt && o.expiresAt < Date.now();

  return (
    <>
      <label className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Grant type</span>
        <Select
          value={o.grantType}
          onValueChange={(grantType) => patch({ grantType: grantType as AuthConfig['oauth2']['grantType'] })}
        >
          <SelectTrigger className="h-8 w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GRANT_LABELS) as AuthConfig['oauth2']['grantType'][]).map((g) => (
              <SelectItem key={g} value={g}>
                {GRANT_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {o.grantType === 'authorization_code' && (
        <Field label="Auth URL" value={o.authUrl} onChange={(authUrl) => patch({ authUrl })} />
      )}
      <Field label="Token URL" value={o.tokenUrl} onChange={(tokenUrl) => patch({ tokenUrl })} />
      <Field label="Client ID" value={o.clientId} onChange={(clientId) => patch({ clientId })} />
      <Field label="Client secret" type="password" value={o.clientSecret} onChange={(clientSecret) => patch({ clientSecret })} />
      <Field label="Scope" value={o.scope} onChange={(scope) => patch({ scope })} />
      {o.grantType === 'password' && (
        <>
          <Field label="Username" value={o.username ?? ''} onChange={(username) => patch({ username })} />
          <Field label="Password" type="password" value={o.password ?? ''} onChange={(password) => patch({ password })} />
        </>
      )}
      <div className="flex items-center gap-2 pl-[124px]">
        <Button size="sm" disabled={busy || !o.tokenUrl.trim()} onClick={() => void getToken(false)}>
          <KeyRound /> {busy ? 'Requesting…' : 'Get new access token'}
        </Button>
        {o.refreshToken && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void getToken(true)}>
            Refresh
          </Button>
        )}
        {expired && <span className="text-xs text-amber-500">Token expired</span>}
      </div>
      <Field
        label="Access token"
        value={o.accessToken}
        onChange={(accessToken) => patch({ accessToken })}
        placeholder="Paste an existing token or get a new one"
      />
      <p className="text-xs text-muted-foreground">
        The access token is sent as a Bearer header. Authorization Code opens your browser and
        listens on a local loopback address for the redirect.
      </p>
    </>
  );
}
