/** The first entry of a header a proxy chain may have joined with commas. */
const first = (value: string | null): string | null =>
  value?.split(',')[0]?.trim() || null;

/**
 * The address a receiver posts callbacks to, built from the request's origin
 * (the web app has no site-URL setting).
 */
export function callbackUrlFor(headers: {
  forwardedHost: string | null;
  host: string | null;
  forwardedProto: string | null;
}): string {
  const host =
    first(headers.forwardedHost) ?? first(headers.host) ?? 'localhost:3000';
  const proto =
    first(headers.forwardedProto) ??
    (host.startsWith('localhost') || host.startsWith('127.')
      ? 'http'
      : 'https');
  return `${proto}://${host}/api/webhooks/callback`;
}
