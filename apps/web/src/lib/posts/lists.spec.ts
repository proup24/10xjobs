// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { groupByJob } from '@/lib/matches/group';
import { matchRow } from '@/components/matches/test-fixtures';
import type { JunkRow, RescueRow } from './load';
import {
  buildPostLists,
  failedReasons,
  pickFailedReason,
  selectPostItems,
  toListRow,
} from './lists';

const NOW = new Date('2026-11-10T21:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const role = (over: Parameters<typeof matchRow>[0]) =>
  matchRow({ kind: 'post_role', ...over });
const empty = { qualified: [], review: [], rejected: [], junk: [], rescues: [] };

describe('buildPostLists', () => {
  it('drops decided matches and chosen reviews', () => {
    const l = buildPostLists({
      ...empty,
      qualified: groupByJob([
        role({ jobId: 'a' }),
        role({ jobId: 'b', decisionStatus: 'applied' }),
      ]),
      review: groupByJob([
        role({ jobId: 'c', outcome: 'review' }),
        role({ jobId: 'd', outcome: 'review', reviewChoice: 'rejected' }),
      ]),
    });
    expect(l.matches.map((i) => i.jobId)).toEqual(['a']);
    expect(l.review.map((i) => i.jobId)).toEqual(['c']);
  });

  it('shows a rescued qualified job once, as Rescued, and a decided rescue nowhere', () => {
    const rescue = (jobId: string, decisionStatus: string | null) =>
      ({
        jobId,
        kind: 'post_role',
        origin: 'disqualified',
        profileIds: ['p9'],
        postedAt: ago(1),
        firstSeenAt: ago(1),
        decisionStatus,
      }) as unknown as RescueRow;
    const l = buildPostLists({
      ...empty,
      qualified: groupByJob([role({ jobId: 'a' })]),
      rejected: groupByJob([role({ jobId: 'b', outcome: 'rejected' })]),
      rescues: [rescue('a', null), rescue('b', 'applied')],
    });
    expect(l.matches.map((i) => [i.jobId, i.rescueOrigin])).toEqual([
      ['a', 'disqualified'],
    ]);
    expect(l.matches[0].job?.jobId).toBe('a');
    expect(l.matches[0].profileIds.sort()).toEqual(
      ['11111111-1111-4111-8111-111111111111', 'p9'].sort(),
    );
    expect(l.disqualified).toEqual([]);
  });

  it('orders Disqualified by newest decision', () => {
    const l = buildPostLists({
      ...empty,
      rejected: groupByJob([
        role({ jobId: 'old', postedAt: ago(1), decidedAt: ago(10) }),
        role({ jobId: 'new', postedAt: ago(9), decidedAt: ago(2) }),
      ]),
    });
    expect(l.disqualified.map((i) => i.jobId)).toEqual(['new', 'old']);
  });
});

describe('selectPostItems', () => {
  it('windows Junk by first seen, the others by posted', () => {
    const junk = buildPostLists({
      ...empty,
      junk: [
        {
          jobId: 'j',
          profileIds: ['p1'],
          verdict: 'junk',
          reason: 'r',
          confidence: 'sure',
          postedAt: ago(50),
          firstSeenAt: ago(2),
        } as unknown as JunkRow,
      ],
    }).junk;
    const f = { tab: '24h', profileId: 'p1', now: NOW } as const;
    expect(selectPostItems(junk, { ...f, list: 'junk' })).toHaveLength(1);
    expect(selectPostItems(junk, { ...f, list: 'matches' })).toHaveLength(0);
    expect(
      selectPostItems(junk, { ...f, list: 'junk', profileId: 'p2' }),
    ).toHaveLength(0);
  });
});

describe('failedReasons', () => {
  it("keeps each row's first failed check, by job and profile", () => {
    const rows = [
      role({
        jobId: 'a',
        profileId: 'p1',
        checks: [
          { outcome: 'pass', reason: 'ok' },
          { outcome: 'fail', reason: 'one' },
          { outcome: 'fail', reason: 'later' },
        ],
      }),
      role({ jobId: 'a', profileId: 'p2', checks: [{ outcome: 'fail', reason: 'two' }] }),
      role({ jobId: 'b', checks: null }),
    ];
    expect(failedReasons(rows)).toEqual({ a: { p1: 'one', p2: 'two' } });
  });
});

describe('pickFailedReason', () => {
  it("prefers the profile's own reason, else the first", () => {
    const by = { p1: 'one', p2: 'two' };
    expect(pickFailedReason(by, 'p2')).toBe('two');
    expect(pickFailedReason(by, 'all')).toBe('one');
    expect(pickFailedReason(undefined, 'all')).toBeNull();
  });
});

describe('toListRow', () => {
  it('drops checks, description and conflicts, and keeps only the arrangement facts', () => {
    const r = toListRow(
      role({
        checks: [{ outcome: 'fail', reason: 'x' }],
        descriptionText: 'long',
        conflicts: [{}],
      }),
    );
    expect(r.checks).toBeNull();
    expect(r.descriptionText).toBeNull();
    expect(r.conflicts).toBeNull();
    expect(Object.keys(r.facts as object).sort()).toEqual([
      'arrangement',
      'openings',
    ]);
    expect((r.facts as { openings: object[] }).openings[0]).toEqual({
      arrangements: [{ code: 'remote', label: 'Remote' }],
    });
  });

  it('keeps null facts null', () => {
    expect(toListRow(role({ facts: null })).facts).toBeNull();
  });
});
