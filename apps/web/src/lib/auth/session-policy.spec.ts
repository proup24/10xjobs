import { describe, expect, it } from 'vitest';
import { decideRoute, signedInAt } from './session-policy';

const now = 1_800_000_000;
const claims = (ageSeconds: number) => ({
  sub: 'u',
  amr: [{ method: 'otp', timestamp: now - ageSeconds }],
});
const expired = {
  action: 'redirect',
  to: '/sign-in?reason=expired',
  signOut: true,
};

describe('decideRoute', () => {
  it('sends a signed-out request for / to /sign-in', () =>
    expect(
      decideRoute({ pathname: '/', claims: null, nowSeconds: now }),
    ).toEqual({ action: 'redirect', to: '/sign-in', signOut: false }));

  it('lets signed-out requests reach /sign-in and /auth/confirm', () => {
    for (const pathname of ['/sign-in', '/auth/confirm', '/auth/confirm/x']) {
      expect(decideRoute({ pathname, claims: null, nowSeconds: now })).toEqual({
        action: 'continue',
      });
    }
  });

  it('does not treat /sign-inx as public', () =>
    expect(
      decideRoute({ pathname: '/sign-inx', claims: null, nowSeconds: now }),
    ).toEqual({ action: 'redirect', to: '/sign-in', signOut: false }));

  it('sends a signed-in user on /sign-in to /', () =>
    expect(
      decideRoute({
        pathname: '/sign-in',
        claims: claims(60),
        nowSeconds: now,
      }),
    ).toEqual({ action: 'redirect', to: '/', signOut: false }));

  it('continues for a session 6 days 23 hours old', () =>
    expect(
      decideRoute({
        pathname: '/',
        claims: claims(6 * 86_400 + 23 * 3_600),
        nowSeconds: now,
      }),
    ).toEqual({ action: 'continue' }));

  it('continues at exactly 7 days', () =>
    expect(
      decideRoute({ pathname: '/', claims: claims(604_800), nowSeconds: now }),
    ).toEqual({ action: 'continue' }));

  it('ends a session older than 7 days', () =>
    expect(
      decideRoute({ pathname: '/', claims: claims(604_801), nowSeconds: now }),
    ).toEqual(expired));

  it('ends an expired session even on a public path', () =>
    expect(
      decideRoute({
        pathname: '/sign-in',
        claims: claims(604_801),
        nowSeconds: now,
      }),
    ).toEqual(expired));

  it('treats claims without amr as expired', () => {
    expect(
      decideRoute({ pathname: '/', claims: { sub: 'u' }, nowSeconds: now }),
    ).toEqual(expired);
    expect(
      decideRoute({
        pathname: '/',
        claims: { sub: 'u', amr: [] },
        nowSeconds: now,
      }),
    ).toEqual(expired);
  });

  it('counts the newest amr entry as the sign-in time', () =>
    expect(
      decideRoute({
        pathname: '/',
        claims: {
          sub: 'u',
          amr: [
            { method: 'otp', timestamp: now - 700_000 },
            { method: 'password', timestamp: now - 100 },
          ],
        },
        nowSeconds: now,
      }),
    ).toEqual({ action: 'continue' }));
});

describe('signedInAt', () => {
  it('uses the newest amr timestamp', () =>
    expect(
      signedInAt({
        sub: 'u',
        amr: [
          { method: 'otp', timestamp: 10 },
          { method: 'password', timestamp: 20 },
        ],
      }),
    ).toBe(20));

  it('is null without amr', () => expect(signedInAt({ sub: 'u' })).toBeNull());
});
