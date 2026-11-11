import { describe, expect, it } from 'vitest';
import { effectivePostedAt, isNew, postedAge } from './freshness';
import type { MatchedJob } from './group';

const now = new Date('2026-11-10T21:00:00Z');
const job = (postedAt: string, over: Partial<MatchedJob> = {}): MatchedJob => ({
  jobId: 'j',
  rows: [],
  postedAt: new Date(postedAt),
  postedExact: true,
  channels: [],
  viewed: false,
  bestStackScore: null,
  unverified: false,
  ...over,
});

describe('isNew and postedAge', () => {
  it('is new within 12 hours when exact and unviewed', () => {
    const j = job('2026-11-10T12:32:26Z');
    expect(isNew(j, now)).toBe(true);
    expect(postedAge(j, now)).toBe('8 h ago');
  });
  it('is not new at 12 h 1 min', () => {
    expect(isNew(job('2026-11-10T08:59:00Z'), now)).toBe(false);
  });
  it('is not new once viewed', () => {
    expect(isNew(job('2026-11-10T12:32:26Z', { viewed: true }), now)).toBe(
      false,
    );
  });
  it('shows a date-only post as a date and never new', () => {
    const j = job('2026-11-10T00:00:00Z', { postedExact: false });
    expect(isNew(j, now)).toBe(false);
    expect(postedAge(j, now)).toBe('Nov 10');
  });
  it('words minutes and days', () => {
    expect(postedAge(job('2026-11-10T20:30:00Z'), now)).toBe('30 min ago');
    expect(postedAge(job('2026-11-08T21:00:00Z'), now)).toBe('2 days ago');
  });
});

describe('effectivePostedAt', () => {
  const base = {
    postedAt: null,
    publishedAt: null,
    firstSeenAt: '2026-11-09T15:00:00+00:00',
  };
  it('prefers postedAt, then the published date at 00:00Z, then first seen', () => {
    expect(
      effectivePostedAt({ ...base, postedAt: '2026-11-10T12:00:00Z' }),
    ).toEqual({ at: new Date('2026-11-10T12:00:00Z'), exact: true });
    expect(effectivePostedAt({ ...base, publishedAt: '2026-11-10' })).toEqual({
      at: new Date('2026-11-10T00:00:00Z'),
      exact: false,
    });
    expect(effectivePostedAt(base)).toEqual({
      at: new Date('2026-11-09T15:00:00Z'),
      exact: false,
    });
  });
});
