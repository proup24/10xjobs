import { exactPostedAt, postedAtFromAgo } from './posted-at';

const scrapedAt = new Date('2026-11-10T20:32:26.671Z');
const ago = (text: unknown, date: string | null = null) =>
  postedAtFromAgo(text, scrapedAt, date);

describe('postedAtFromAgo', () => {
  it('subtracts the relative amount from the scrape time', () => {
    expect(ago('8 hours ago', '2026-11-10')).toBe('2026-11-10T12:32:26.671Z');
    expect(ago('1 hour ago')).toBe('2026-11-10T19:32:26.671Z');
    expect(ago('45 minutes ago')).toBe('2026-11-10T19:47:26.671Z');
    expect(ago('1 minute ago')).toBe('2026-11-10T20:31:26.671Z');
    expect(ago('2 days ago', '2026-11-08')).toBe('2026-11-08T20:32:26.671Z');
    expect(ago('1 week ago', '2026-11-03')).toBe('2026-11-03T20:32:26.671Z');
  });

  it('treats a month as 30 days, clamped into its date if given', () => {
    expect(ago('1 month ago')).toBe('2026-10-11T20:32:26.671Z');
    expect(ago('1 month ago', '2026-10-12')).toBe('2026-10-12T00:00:00.000Z');
  });

  it('accepts a reposted prefix and just-now phrases', () => {
    expect(ago('Reposted 2 hours ago')).toBe('2026-11-10T18:32:26.671Z');
    expect(ago('just now')).toBe('2026-11-10T20:32:26.671Z');
    expect(ago('moments ago')).toBe('2026-11-10T20:32:26.671Z');
  });

  it('clamps into the published day', () => {
    expect(ago('20 hours ago', '2026-11-09')).toBe('2026-11-09T23:59:59.999Z');
    expect(ago('3 days ago', '2026-11-09')).toBe('2026-11-09T00:00:00.000Z');
  });

  it('never lands after the scrape', () => {
    expect(ago('1 hour ago', '2026-11-11')).toBe('2026-11-10T19:32:26.671Z');
  });

  it('is unclamped without a date', () => {
    expect(ago('8 hours ago', null)).toBe('2026-11-10T12:32:26.671Z');
  });

  it('returns null instead of throwing for out-of-range values', () => {
    expect(ago('99999999999 days ago')).toBeNull();
    expect(postedAtFromAgo('1 hour ago', new Date(NaN), null)).toBeNull();
  });

  it('ignores a malformed published date', () => {
    expect(ago('8 hours ago', '2026-13-45')).toBe('2026-11-10T12:32:26.671Z');
    expect(ago('8 hours ago', 'garbage')).toBe('2026-11-10T12:32:26.671Z');
  });

  it.each(['', null, 42, '30+ days ago', 'il y a 3 heures', 'soon'])(
    'returns null for %j',
    (value) => {
      expect(ago(value)).toBeNull();
    },
  );
});

describe('exactPostedAt', () => {
  it('converts a datetime to UTC', () => {
    expect(exactPostedAt('2026-10-29T23:30:00-04:00')).toBe(
      '2026-10-30T03:30:00.000Z',
    );
  });

  it('rejects date-only and bad values', () => {
    expect(exactPostedAt('2026-10-29')).toBeNull();
    expect(exactPostedAt('nope')).toBeNull();
    expect(exactPostedAt(null)).toBeNull();
  });
});
