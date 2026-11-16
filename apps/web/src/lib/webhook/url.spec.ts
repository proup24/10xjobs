import { describe, expect, it } from 'vitest';
import { urlProblem } from './url';

// The same table as `webhook_url_ok` in apps/db-tests/src/webhooks-rpcs.db.spec.ts.
describe('urlProblem', () => {
  it.each([
    'http://hook.example.com/a',
    'ftp://hook.example.com/a',
    'hook.example.com/a',
    'https://user:pass@hook.example.com/a',
    'https://user@hook.example.com/a',
    'https://localhost/a',
    'https://LOCALHOST:8443/a',
    'https://localhost./a',
    'https://app.localhost/a',
    'https://printer.local/a',
    'https://x.internal/a',
    'https://metadata.google.internal/computeMetadata',
    'https://10.0.0.1/a',
    'https://169.254.169.254/latest',
    'https://127.0.0.1:443/a',
    'https://2130706433/a',
    'https://0x7f.0.0.1/a',
    'https://[::1]/a',
    'https://[fd00::1]:8443/a',
    'https://hook.example.com:0/a',
    'https://hook.example.com:65536/a',
    'https://hook.example.com:99999/a',
    'https://hook.example.com:/a',
    'https:///a',
    'https://hook.example.com/a b',
    'https://hook.example.com/' + 'x'.repeat(2048),
    // Beyond the shared table: the rest of the SQL rule.
    'https://x.internal./a',
    'https://hook.example.com\\a',
    'https://hook.example.com/a\u0007',
    'https://ho%6fk.example.com/a',
    'https://hook..example.com/a',
    'https://.hook.example.com/a',
    'https://hook.example.com:123456/a',
    'https://hook.example.com.0x/a',
    'https://hôok.example.com/a',
  ])('rejects %s', (url) => {
    expect(urlProblem(url)).toEqual(expect.any(String));
  });

  it.each([
    'https://hook.example.com:8443/a?x=1#y',
    'https://hook.example.com:1/a',
    'https://hook.example.com:65535/a',
    'https://hooks.example.com/10.0.0.1',
    'HTTPS://Hook.Example.com/a',
    'https://hooks.zapier.com/hooks/catch/1/abc/',
    'https://hook.example.com.',
    'https://webhook.site/0b1c-2d3e',
    'https://hook.example.com/a%20b',
    'https://xn--hok-una.example.com/a',
  ])('accepts %s', (url) => {
    expect(urlProblem(url)).toBeNull();
  });

  it('names the reason', () => {
    expect(urlProblem('https://hook.example.com:65536/a')).toBe(
      'Use a port from 1 to 65535.',
    );
    expect(urlProblem('http://hook.example.com/')).toBe('Use an https:// URL.');
    expect(urlProblem('https://10.0.0.1/')).toBe(
      'Use a host name, not an IP address.',
    );
    expect(urlProblem('https://localhost/')).toBe(
      'Use a public host, not localhost or a local network name.',
    );
    expect(urlProblem('https://a:b@hook.example.com/')).toBe(
      'Remove the user name and password from the URL.',
    );
  });
});
