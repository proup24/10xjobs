import { describe, expect, it } from 'vitest';
import { callbackUrlFor } from './callback-url';

const none = { forwardedHost: null, host: null, forwardedProto: null };

describe('callbackUrlFor', () => {
  it('uses the forwarded host and proto', () => {
    expect(
      callbackUrlFor({
        forwardedHost: 'app.example.com',
        host: 'internal:3000',
        forwardedProto: 'https',
      }),
    ).toBe('https://app.example.com/api/webhooks/callback');
  });

  it('takes the first entry of comma-separated forwarded headers', () => {
    expect(
      callbackUrlFor({
        forwardedHost: 'app.example.com, proxy.internal',
        host: null,
        forwardedProto: 'https, http',
      }),
    ).toBe('https://app.example.com/api/webhooks/callback');
  });

  it('falls back to host, and to http on localhost', () => {
    expect(callbackUrlFor({ ...none, host: 'localhost:3000' })).toBe(
      'http://localhost:3000/api/webhooks/callback',
    );
    expect(callbackUrlFor({ ...none, host: 'app.example.com' })).toBe(
      'https://app.example.com/api/webhooks/callback',
    );
    expect(callbackUrlFor(none)).toBe(
      'http://localhost:3000/api/webhooks/callback',
    );
  });
});
