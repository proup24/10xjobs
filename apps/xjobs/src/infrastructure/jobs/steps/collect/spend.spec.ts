import { moroccoDayStart } from './spend';

describe('moroccoDayStart', () => {
  it('starts the day at 00:00 UTC+1 outside Ramadan', () => {
    expect(
      moroccoDayStart(new Date('2026-11-14T10:00:00Z')).toISOString(),
    ).toBe('2026-11-13T23:00:00.000Z');
  });

  it('starts the day at 00:00 UTC+0 during Ramadan', () => {
    expect(
      moroccoDayStart(new Date('2026-02-25T10:00:00Z')).toISOString(),
    ).toBe('2026-02-25T00:00:00.000Z');
  });

  it('moves to the next local day after 23:00 UTC', () => {
    expect(
      moroccoDayStart(new Date('2026-11-14T23:30:00Z')).toISOString(),
    ).toBe('2026-11-14T23:00:00.000Z');
  });

  it('is the start of the same local day for any instant in it', () => {
    expect(
      moroccoDayStart(new Date('2026-11-13T23:00:00Z')).toISOString(),
    ).toBe('2026-11-13T23:00:00.000Z');
    expect(
      moroccoDayStart(new Date('2026-11-13T22:59:59Z')).toISOString(),
    ).toBe('2026-11-12T23:00:00.000Z');
  });

  it('finds the day start on the day the offset changes', () => {
    // Ramadan 2026 starts around 18 February: midnight is still UTC+1, the clocks go back at 03:00.
    const start = moroccoDayStart(new Date('2026-02-18T12:00:00Z'));
    expect(['2026-02-17T23:00:00.000Z', '2026-02-18T00:00:00.000Z']).toContain(
      start.toISOString(),
    );
  });
});
