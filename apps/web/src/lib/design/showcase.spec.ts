import { describe, expect, it } from 'vitest';
import { isShowcaseEnabled } from './showcase';

describe('isShowcaseEnabled', () => {
  it('is off only in Vercel production', () => {
    expect(isShowcaseEnabled({ VERCEL_ENV: 'production' })).toBe(false);
    expect(isShowcaseEnabled({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(isShowcaseEnabled({})).toBe(true);
  });
});
