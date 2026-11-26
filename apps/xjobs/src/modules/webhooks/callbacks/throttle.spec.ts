import { describe, expect, it } from 'vitest';
import { CallbackThrottle } from './throttle';

describe('CallbackThrottle', () => {
  it('allows 60 in a minute, refuses the 61st, allows again after the window', () => {
    const t = new CallbackThrottle(60);
    for (let i = 0; i < 60; i++) expect(t.allow('w', 1000 + i)).toBe(true);
    expect(t.allow('w', 2000)).toBe(false);
    expect(t.allow('w', 1000 + 60_000 + 60)).toBe(true);
  });
  it('counts webhooks separately', () => {
    const t = new CallbackThrottle(1);
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('a', 1)).toBe(false);
    expect(t.allow('b', 1)).toBe(true);
  });
});
