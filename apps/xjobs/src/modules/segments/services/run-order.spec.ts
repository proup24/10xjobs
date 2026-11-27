import { describe, expect, it } from 'vitest';
import type { QuerySearchBuilderRow } from 'src/database';
import { longestWaitingFirst } from './run-order';
import type { SearchSegment } from './segments';

const at = (hour: number) => new Date(Date.UTC(2026, 10, 27, hour, 0, 0));

const segment = (key: string, ...cursors: (Date | null)[]): SearchSegment =>
  ({
    key,
    hash: key,
    channel: 'LINKEDIN_POSTS',
    members: cursors.map((coveredUntil, i) => ({
      id: `${key}-${i}`,
      coveredUntil,
    })) as unknown as QuerySearchBuilderRow[],
  }) as unknown as SearchSegment;

const keys = (segments: SearchSegment[]) => segments.map((s) => s.key);

describe('longestWaitingFirst', () => {
  it('sorts by the oldest cursor, ascending', () => {
    const sorted = longestWaitingFirst([
      segment('a', at(10)),
      segment('b', at(8)),
      segment('c', at(9)),
    ]);
    expect(keys(sorted)).toEqual(['b', 'c', 'a']);
  });

  it('puts a segment with a never-covered member before any dated one', () => {
    const sorted = longestWaitingFirst([
      segment('dated', at(6)),
      segment('fresh', at(7), null),
    ]);
    expect(keys(sorted)).toEqual(['fresh', 'dated']);
  });

  it('keeps the input order for equal oldest cursors', () => {
    const sorted = longestWaitingFirst([
      segment('x', at(8), at(12)),
      segment('y', at(8)),
      segment('z', null),
      segment('w', null),
    ]);
    expect(keys(sorted)).toEqual(['z', 'w', 'x', 'y']);
  });

  it('does not mutate the input', () => {
    const input = [segment('a', at(10)), segment('b', at(8))];
    const sorted = longestWaitingFirst(input);
    expect(keys(input)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(input);
  });
});
