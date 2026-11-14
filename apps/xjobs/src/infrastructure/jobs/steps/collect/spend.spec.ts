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
});
