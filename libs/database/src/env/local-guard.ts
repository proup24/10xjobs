/** Hosts of the local Supabase CLI stack. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * @description Returns the hostname of `url` with IPv6 brackets stripped, or
 * undefined when it does not parse.
 */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
}

/**
 * @description True when `url` points at the local Supabase stack
 * (`127.0.0.1`, `localhost` or `::1`). Unparseable URLs are not local.
 */
export function isLocalUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== undefined && LOCAL_HOSTS.has(host);
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
    if (url === undefined || isLocalUrl(url)) continue;
    throw new Error(
      `Refusing to use ${name} at non-local host ${hostOf(url) ?? '<unparseable>'}. Set XJOBS_ALLOW_REMOTE_DB=1 to allow it.`,
    );
  }
}
