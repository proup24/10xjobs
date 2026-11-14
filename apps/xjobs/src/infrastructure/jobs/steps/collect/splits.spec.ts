import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { type SearchSegment, segmentHash } from 'src/modules/segments';
import { halve, nextParts } from './splits';

const member = (n: number) =>
  ({
    id: `qs-${n}`,
    hash: `h-${n}`,
    channel: Channel.LINKEDIN_JOB_BOARD,
  }) as unknown as QuerySearchBuilderRow;

const segment = (count: number): SearchSegment => {
  const key = 'LINKEDIN_JOB_BOARD|remote|group:x';
  const members = Array.from({ length: count }, (_, i) => member(i + 1));
  return {
    key,
    hash: segmentHash(
      key,
      members.map(({ id }) => id),
    ),
    channel: Channel.LINKEDIN_JOB_BOARD,
    members,
  };
};

describe('halve', () => {
  it('splits 5 members into 3 and 2, in hash order', () => {
    const [first, second] = halve(segment(5));
    expect(first.members.map(({ id }) => id)).toEqual(['qs-1', 'qs-2', 'qs-3']);
    expect(second.members.map(({ id }) => id)).toEqual(['qs-4', 'qs-5']);
  });

  it('orders members by hash whatever their order in the segment', () => {
    const whole = segment(4);
    const [first, second] = halve({
      ...whole,
      members: [...whole.members].reverse(),
    });
    expect(first.members.map(({ id }) => id)).toEqual(['qs-1', 'qs-2']);
    expect(second.members.map(({ id }) => id)).toEqual(['qs-3', 'qs-4']);
  });

  it('keeps the key and hashes each half by its members', () => {
    const whole = segment(4);
    const halves = halve(whole);
    for (const half of halves) {
      expect(half.key).toBe(whole.key);
      expect(half.channel).toBe(whole.channel);
      expect(half.hash).toBe(
        segmentHash(
          whole.key,
          half.members.map(({ id }) => id),
        ),
      );
    }
    expect(halves[0].hash).not.toBe(halves[1].hash);
  });
});

describe('nextParts', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const tick = (overrides: Partial<Parameters<typeof nextParts>[1]> = {}) => ({
    groupKey: 'g',
    chunks: 1,
    split: false,
    maxReturned: 3,
    rowLimit: 100,
    ...overrides,
  });

  it('remembers a split made in this tick', () => {
    expect(nextParts(undefined, tick({ chunks: 2, split: true }), now)).toBe(2);
  });

  it('grows a remembered split that was split again', () => {
    expect(
      nextParts(
        { parts: 2, splitAt: ago(10) },
        tick({ chunks: 3, split: true, maxReturned: 100 }),
        now,
      ),
    ).toBe(3);
  });

  it('ignores extra chunks that no split made (a keyword that does not fit)', () => {
    expect(nextParts(undefined, tick({ chunks: 2 }), now)).toBeNull();
  });

  it('keeps a split made under an hour ago', () => {
    expect(
      nextParts(
        { parts: 4, splitAt: ago(30) },
        tick({ chunks: 4, maxReturned: 3 }),
        now,
      ),
    ).toBeNull();
  });

  it('halves a split made over an hour ago once searches run small', () => {
    expect(
      nextParts(
        { parts: 4, splitAt: ago(120) },
        tick({ chunks: 4, maxReturned: 3 }),
        now,
      ),
    ).toBe(2);
  });

  it('forgets a split of 2 or 3 parts by returning 1', () => {
    expect(
      nextParts({ parts: 3, splitAt: ago(60) }, tick({ chunks: 3 }), now),
    ).toBe(1);
  });

  it('keeps a split while any search returns 25% of the row limit or more', () => {
    expect(
      nextParts(
        { parts: 4, splitAt: ago(120) },
        tick({ chunks: 4, maxReturned: 25 }),
        now,
      ),
    ).toBeNull();
  });

  it('does not undo a split in a tick that split again', () => {
    expect(
      nextParts(
        { parts: 4, splitAt: ago(120) },
        tick({ chunks: 4, split: true, maxReturned: 3 }),
        now,
      ),
    ).toBeNull();
  });

  it('changes nothing for a group never split', () => {
    expect(nextParts(undefined, tick(), now)).toBeNull();
  });
});
