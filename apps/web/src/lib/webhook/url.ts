/**
 * Why a webhook URL can't be saved, or null when it can: the client-side mirror of
 * `webhook_url_ok` (latest in migration 20261116T0829_webhook_hardening), used only for the
 * message. The RPC enforces the rule, so keep the two in step: https only, at most 2048
 * characters, no spaces, control characters or backslashes, no userinfo, a port (if any) from
 * 1 to 65535, and a host that is an ASCII DNS name other than localhost, *.localhost, *.local
 * and *.internal and is not an IP literal (bracketed IPv6, or a last label that is a decimal
 * or 0x-hex number, which URL parsers read as IPv4).
 */
export function urlProblem(url: string): string | null {
  if (!/^https:\/\//i.test(url)) return 'Use an https:// URL.';
  if (url.length > 2048) return 'Use a URL of at most 2048 characters.';
  // Whitespace, control characters and the backslash, as `[[:space:][:cntrl:]\\]`.
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f\\]/.test(url)) {
    return 'Remove spaces and backslashes from the URL.';
  }
  // Everything between "https://" and the path, query or fragment.
  const authority = /^[^/?#]*/.exec(url.slice(8))?.[0] ?? '';
  if (authority.includes('@')) {
    return 'Remove the user name and password from the URL.';
  }
  if (authority.startsWith('[')) return 'Use a host name, not an IP address.';
  // The host, without an optional port and trailing dots.
  const m = /^([^:]*)(:[0-9]{1,5})?$/.exec(authority);
  const host = m ? m[1].toLowerCase().replace(/\.+$/, '') : '';
  if (!/^[a-z0-9._-]+$/.test(host) || /(^\.|\.\.)/.test(host)) {
    return 'Enter a full URL such as https://hooks.example.com/path.';
  }
  const port = m?.[2] ? Number(m[2].slice(1)) : null;
  if (port !== null && (port < 1 || port > 65535)) {
    return 'Use a port from 1 to 65535.';
  }
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) {
    return 'Use a public host, not localhost or a local network name.';
  }
  if (/(^|\.)(0x[0-9a-f]*|[0-9]+)$/.test(host)) {
    return 'Use a host name, not an IP address.';
  }
  return null;
}
