/** Time allowed for Google to answer one redirect lookup. */
const REDIRECT_TIMEOUT_MS = 10_000;

/** Google now often returns `google.com/goto?url=<encrypted>` instead of the result's URL. */
export function isGoogleRedirect(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      /^(www\.)?google\.[a-z.]+$/.test(hostname) &&
      (pathname === '/goto' || pathname === '/url')
    );
  } catch {
    return false;
  }
}

/** The URL a Google redirect link points to, read from its 3xx `Location`; one request, nothing followed. */
export async function resolveGoogleRedirect(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
  });
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location)
    return new URL(location, url).toString();
  throw new Error(`Google redirect not resolved: HTTP ${response.status}`);
}
