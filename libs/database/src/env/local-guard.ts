/** Hosts of the local Supabase CLI stack. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * @description Returns the first non-local host `url` would connect to, or
 * undefined when every host is local. Besides the authority, pg-connection-string
 * and libpq let `host` and `hostaddr` query parameters override it, so those
 * count too (socket paths included). Unparseable URLs yield `<unparseable>`.
 */
function remoteHostOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '<unparseable>';
  }
  const hosts = [parsed.hostname.replace(/^\[|\]$/g, '')];
  for (const key of ['host', 'hostaddr']) {
    for (const value of parsed.searchParams.getAll(key)) {
      hosts.push(...value.split(','));
    }
  }
  return hosts.find((host) => !LOCAL_HOSTS.has(host));
}

/**
 * @description True when every host `url` connects to is the local Supabase
 * stack (`127.0.0.1`, `localhost` or `::1`). Unparseable URLs are not local.
 */
export function isLocalUrl(url: string): boolean {
  return remoteHostOf(url) === undefined;
}

/**
 * @description Copies the remote opt-in out of `env`. Call it before any env
 * file is loaded, so `XJOBS_ALLOW_REMOTE_DB=1` in a `.env` cannot disable the
 * guard; only the shell, CI or an inline assignment can.
 */
export function captureRemoteOptIn(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { XJOBS_ALLOW_REMOTE_DB: env.XJOBS_ALLOW_REMOTE_DB };
}

/**
 * @description Throws unless every defined URL is local, or
 * `XJOBS_ALLOW_REMOTE_DB=1` is set. The message names the variable and host
 * only, never the password or the full URL.
 */
export function assertLocalDatabase(
  urls: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv,
): void {
  if (env.XJOBS_ALLOW_REMOTE_DB === '1') return;
  for (const [name, url] of Object.entries(urls)) {
    if (url === undefined) continue;
    const host = remoteHostOf(url);
    if (host === undefined) continue;
    throw new Error(
      `Refusing to use ${name} at non-local host ${host}. Set XJOBS_ALLOW_REMOTE_DB=1 to allow it.`,
    );
  }
}
