import { describe, expect, it } from 'vitest';
import { signature } from '../sender/sign';
import { verifyCallback } from './verify';

const body = Buffer.from('{"version":1,"type":"ping"}');
const now = 1_700_000_000;
const input = (over: Partial<Parameters<typeof verifyCallback>[0]> = {}) => ({
  secret: 's3cret',
  timestamp: String(now),
  received: signature('s3cret', now, body),
  rawBody: body,
  nowSeconds: now,
  ...over,
});

describe('verifyCallback', () => {
  it('accepts a good signature', () => {
    expect(verifyCallback(input())).toBe(true);
  });
  it('refuses a wrong secret', () => {
    expect(verifyCallback(input({ secret: 'other' }))).toBe(false);
  });
  it('refuses a stale timestamp (301 s old)', () => {
    const t = now - 301;
    expect(
      verifyCallback(
        input({ timestamp: String(t), received: signature('s3cret', t, body) }),
      ),
    ).toBe(false);
  });
  it('refuses a future timestamp (301 s ahead)', () => {
    const t = now + 301;
    expect(
      verifyCallback(
        input({ timestamp: String(t), received: signature('s3cret', t, body) }),
      ),
    ).toBe(false);
  });
  it('accepts 300 s either way', () => {
    for (const t of [now - 300, now + 300])
      expect(
        verifyCallback(
          input({
            timestamp: String(t),
            received: signature('s3cret', t, body),
          }),
        ),
      ).toBe(true);
  });
  it('refuses a missing or non-numeric timestamp', () => {
    expect(verifyCallback(input({ timestamp: undefined }))).toBe(false);
    expect(verifyCallback(input({ timestamp: 'abc' }))).toBe(false);
    expect(verifyCallback(input({ received: undefined }))).toBe(false);
  });
  it('refuses a signature differing in length', () => {
    expect(verifyCallback(input({ received: 'v1=abcd' }))).toBe(false);
    expect(verifyCallback(input({ received: '' }))).toBe(false);
  });
});
