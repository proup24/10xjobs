import { moroccoDayStart, nextMoroccoDayStart } from './spend';

// The expected instants depend on the tz data Node ships. Morocco was UTC+1
// with UTC+0 for Ramadan; tzdata 2026e moves it to UTC+0 from 2026-09-20.
// The fixed cases below use dates every tz data release agrees on (before
// 2026-09-20); the last case checks the rule itself, whatever the offset.

/** Morocco's wall clock at `instant`, as `YYYY-MM-DD HH:mm`. */
function moroccoClock(instant: Date): string {
  const value = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Casablanca',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}`;
}

describe('moroccoDayStart', () => {
  it('starts the day at 00:00 UTC+1 outside Ramadan', () => {
    expect(
      moroccoDayStart(new Date('2026-06-14T10:00:00Z')).toISOString(),
    ).toBe('2026-06-13T23:00:00.000Z');
  });

  it('starts the day at 00:00 UTC+0 during Ramadan', () => {
    expect(
      moroccoDayStart(new Date('2026-02-25T10:00:00Z')).toISOString(),
    ).toBe('2026-02-25T00:00:00.000Z');
  });

  it('moves to the next local day after 23:00 UTC', () => {
    expect(
      moroccoDayStart(new Date('2026-06-14T23:30:00Z')).toISOString(),
    ).toBe('2026-06-14T23:00:00.000Z');
  });

  it('is the start of the same local day for any instant in it', () => {
    expect(
      moroccoDayStart(new Date('2026-06-13T23:00:00Z')).toISOString(),
    ).toBe('2026-06-13T23:00:00.000Z');
    expect(
      moroccoDayStart(new Date('2026-06-13T22:59:59Z')).toISOString(),
    ).toBe('2026-06-12T23:00:00.000Z');
  });

  it('finds the day start when Ramadan begins, midnight still UTC+1', () => {
    expect(
      moroccoDayStart(new Date('2026-02-15T12:00:00Z')).toISOString(),
    ).toBe('2026-02-14T23:00:00.000Z');
  });

  it('finds the day start when Ramadan ends, midnight still UTC+0', () => {
    expect(
      moroccoDayStart(new Date('2026-03-22T12:00:00Z')).toISOString(),
    ).toBe('2026-03-22T00:00:00.000Z');
  });

  it('is local midnight of the same Morocco date, whatever the tz data', () => {
    for (const iso of [
      '2026-11-14T00:30:00Z',
      '2026-11-14T10:00:00Z',
      '2026-11-14T23:30:00Z',
      '2027-06-01T12:00:00Z',
    ]) {
      const now = new Date(iso);
      const start = moroccoDayStart(now);
      expect(moroccoClock(start)).toBe(
        `${moroccoClock(now).slice(0, 10)} 00:00`,
      );
      expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime() - start.getTime()).toBeLessThan(25 * 3_600_000);
    }
  });
});

describe('nextMoroccoDayStart', () => {
  it('is the next Morocco midnight in normal time', () => {
    expect(
      nextMoroccoDayStart(new Date('2026-06-14T15:00:00Z')).toISOString(),
    ).toBe('2026-06-14T23:00:00.000Z');
  });

  it('is after `now` even at an exact midnight', () => {
    expect(
      nextMoroccoDayStart(new Date('2026-06-14T23:00:00Z')).toISOString(),
    ).toBe('2026-06-15T23:00:00.000Z');
  });

  // Morocco changes offset at 02:00 UTC on 2026-02-15 and 2026-03-22 (tzdata
  // 2026e); the next midnight is the day start of an instant just after it.
  // The Ramadan day is 25 hours (offset change at 02:00 UTC 2026-02-15) and
  // the one after is 23 hours; "day start of now + 24h" is wrong near them.
  it('finds the next midnight when the local day is 25 hours long', () => {
    expect(
      nextMoroccoDayStart(new Date('2026-02-14T23:30:00Z')).toISOString(),
    ).toBe('2026-02-16T00:00:00.000Z');
  });

  it('finds the next midnight before the 23-hour day', () => {
    expect(
      nextMoroccoDayStart(new Date('2026-03-21T23:30:00Z')).toISOString(),
    ).toBe('2026-03-22T00:00:00.000Z');
  });

  it('matches the day start just after the next midnight across an offset change', () => {
    for (const iso of [
      '2026-02-14T12:00:00Z',
      '2026-02-15T12:00:00Z',
      '2026-03-21T12:00:00Z',
      '2026-03-22T12:00:00Z',
    ]) {
      const now = new Date(iso);
      const next = nextMoroccoDayStart(now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.toISOString()).toBe(
        moroccoDayStart(new Date(next.getTime() + 1000)).toISOString(),
      );
      expect(moroccoClock(next).slice(11)).toBe('00:00');
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(
        25 * 3_600_000,
      );
    }
  });
});
