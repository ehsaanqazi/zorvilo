import * as React from 'react';
import { appInfo, type AppInfo } from '@/platform/system';

export const REPO_URL = 'https://github.com/ehsaanqazi/zorvilo';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new`;

let cached: Promise<AppInfo> | null = null;

/** Backend app info (version, data dir, …), fetched once per session. */
export function useAppInfo(): { info: AppInfo | null; error: string | null } {
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    cached ??= appInfo();
    cached.then(
      (i) => alive && setInfo(i),
      (err: unknown) => {
        cached = null;
        if (alive) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return { info, error };
}
