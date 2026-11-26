import { Channel } from 'src/common/enums';
import type { SegmentSearch } from '../../types/collector';
import { indeedDatePosted, toIndeedInput } from './indeed-input';

const hours = (n: number) => {
  const until = new Date('2026-11-26T09:00:00Z');
  return { since: new Date(until.getTime() - n * 3_600_000), until };
};

describe('indeedDatePosted', () => {
  it('asks one day for an hourly window', () => {
    const { since, until } = hours(1);
    expect(indeedDatePosted(since, until)).toBe('1');
  });
  it('asks three days for a 60-hour window', () => {
    const { since, until } = hours(60);
    expect(indeedDatePosted(since, until)).toBe('3');
  });
  it('asks three days at the 72-hour maximum', () => {
    const { since, until } = hours(72);
    expect(indeedDatePosted(since, until)).toBe('3');
  });
  it('asks seven days past 72 hours', () => {
    const { since, until } = hours(73);
    expect(indeedDatePosted(since, until)).toBe('7');
  });
});

describe('toIndeedInput', () => {
  it('sends exactly the five fields', () => {
    const { since, until } = hours(1);
    const segment: SegmentSearch = {
      channel: Channel.INDEED,
      since,
      until,
      queries: [
        {
          id: 'a',
          keyword: 'kw',
          params: {
            site: 'us',
            location: 'Remote',
            roleWords: ['backend engineer'],
            spellings: ['node'],
          },
        },
      ],
    };
    const input = toIndeedInput(segment, 1000);
    expect(input).toEqual({
      country: 'us',
      title: expect.any(String),
      location: 'Remote',
      limit: 1000,
      datePosted: '1',
    });
    expect(Object.keys(input).sort()).toEqual([
      'country',
      'datePosted',
      'limit',
      'location',
      'title',
    ]);
    expect(input.title).toContain('backend engineer');
  });
});
