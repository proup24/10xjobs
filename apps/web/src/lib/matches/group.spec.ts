import { describe, expect, it } from 'vitest';
import {
  groupByJob,
  publishedRows,
  selectJobs,
  sourceOptions,
  type MatchRow,
  type MatchedJob,
} from './group';

// The generated row type is non-null; the columns are nullable in Postgres.
type Over = { [K in keyof MatchRow]?: MatchRow[K] | null };
const row = (over: Over = {}): MatchRow =>
  ({
    jobId: 'J',
    profileId: 'P1',
    closed: false,
    unverified: false,
    channels: ['LINKEDIN_JOB_BOARD'],
    postedAt: '2026-11-10T12:00:00Z',
    publishedAt: null,
    firstSeenAt: '2026-11-10T13:00:00Z',
    viewedAt: null,
    stackScore: null,
    ...over,
  }) as MatchRow;

describe('groupByJob', () => {
  it('merges one job across profiles and keeps the best stack score', () => {
    const jobs = groupByJob([
      row({ profileId: 'P1', stackScore: 0.5 }),
      row({ profileId: 'P2', stackScore: 0.8 }),
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].rows).toHaveLength(2);
    expect(jobs[0].bestStackScore).toBe(0.8);
  });
  it('treats null as the lowest score and null when all are null', () => {
    const [a] = groupByJob([
      row({ profileId: 'P1', stackScore: null }),
      row({ profileId: 'P2', stackScore: 0.2 }),
    ]);
    expect(a.bestStackScore).toBe(0.2);
    expect(groupByJob([row()])[0].bestStackScore).toBeNull();
  });
  it('drops closed jobs', () => {
    expect(groupByJob([row({ closed: true })])).toEqual([]);
  });
  it('sorts by effective posted time, date-only at 00:00Z', () => {
    const jobs = groupByJob([
      row({ jobId: 'A', postedAt: null, publishedAt: '2026-11-10' }),
      row({ jobId: 'B', postedAt: '2026-11-10T08:00:00Z' }),
      row({ jobId: 'C', postedAt: '2026-11-09T23:00:00Z' }),
    ]);
    expect(jobs.map((j) => j.jobId)).toEqual(['B', 'A', 'C']);
    expect(jobs[1].postedExact).toBe(false);
  });
  it('breaks ties by job id', () => {
    const jobs = groupByJob([row({ jobId: 'b' }), row({ jobId: 'a' })]);
    expect(jobs.map((j) => j.jobId)).toEqual(['a', 'b']);
  });
  it('marks viewed from viewedAt', () => {
    expect(
      groupByJob([row({ viewedAt: '2026-11-10T14:00:00Z' })])[0].viewed,
    ).toBe(true);
  });
});

describe('selectJobs', () => {
  const now = new Date('2026-11-10T21:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const job = (over: Partial<MatchedJob>): MatchedJob => ({
    jobId: 'j',
    rows: [row()],
    postedAt: ago(10),
    postedExact: true,
    channels: ['LINKEDIN_JOB_BOARD'],
    viewed: false,
    bestStackScore: null,
    unverified: false,
    ...over,
  });
  const all = { profileId: 'all', source: 'all', now } as const;

  it('24h keeps 23 h 59 min and drops 24 h 1 min; 7d keeps both', () => {
    const jobs = [
      job({ jobId: 'in', postedAt: ago(23 * 60 + 59) }),
      job({ jobId: 'out', postedAt: ago(24 * 60 + 1) }),
    ];
    expect(
      selectJobs(jobs, { ...all, tab: '24h' }).map((j) => j.jobId),
    ).toEqual(['in']);
    expect(selectJobs(jobs, { ...all, tab: '7d' })).toHaveLength(2);
  });
  it('filters by profile', () => {
    const jobs = [
      job({ jobId: 'a', rows: [row({ profileId: 'P1' })] }),
      job({
        jobId: 'b',
        rows: [row({ profileId: 'P1' }), row({ profileId: 'P2' })],
      }),
    ];
    expect(
      selectJobs(jobs, { ...all, tab: '7d', profileId: 'P2' }).map(
        (j) => j.jobId,
      ),
    ).toEqual(['b']);
  });
  it('filters by source', () => {
    const jobs = [
      job({ jobId: 'a', channels: ['ASHBY', 'LINKEDIN_JOB_BOARD'] }),
      job({ jobId: 'b', channels: ['GREEN_HOUSE'] }),
    ];
    expect(
      selectJobs(jobs, { ...all, tab: '7d', source: 'ASHBY' }).map(
        (j) => j.jobId,
      ),
    ).toEqual(['a']);
  });
});

describe('sourceOptions', () => {
  it('lists only present channels, labelled', () => {
    const jobs = [
      { channels: ['ASHBY', 'LINKEDIN_POSTS'] },
      { channels: ['ASHBY'] },
    ] as MatchedJob[];
    expect(sourceOptions(jobs)).toEqual([
      { value: 'ASHBY', label: 'Ashby' },
      { value: 'LINKEDIN_POSTS', label: 'LinkedIn posts' },
    ]);
  });
});

describe('publishedRows', () => {
  it("drops rows of profiles that aren't published, so every view and count skips them", () => {
    const rows = [
      row({ jobId: 'a', profileId: 'P1' }),
      row({ jobId: 'a', profileId: 'D' }),
      row({ jobId: 'b', profileId: 'D' }),
      row({ jobId: 'c', profileId: 'gone' }),
    ];
    const kept = publishedRows(rows, [
      { id: 'P1', state: 'published' },
      { id: 'D', state: 'draft' },
    ]);
    expect(kept.map((r) => `${r.jobId}:${r.profileId}`)).toEqual(['a:P1']);
    expect(groupByJob(kept).map((j) => j.jobId)).toEqual(['a']);
  });
});
