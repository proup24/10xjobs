// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import type { MatchRow } from './group';
import { decidedJobHref, decidedJobId, selectedRows } from './selected';

const J = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = (jobId: string, profileId = 'P1', closed = false) =>
  ({ jobId, profileId, closed }) as MatchRow;
const profiles = [
  { id: 'P1', state: 'published' as const },
  { id: 'D', state: 'draft' as const },
];

describe('selectedRows', () => {
  it('is null without a job', async () => {
    const f = fakeSupabase();
    expect(await selectedRows(f.supabase, null, profiles)).toBeNull();
    expect(f.rpcs('match_details')).toHaveLength(0);
  });

  // The window's list rows carry no checks, description or full facts, so the job is
  // always read on its own, whether or not it is in the window.
  it("reads the job's full rows, published profiles only", async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [row(J), row(J, 'D')], error: null }),
    });
    expect(await selectedRows(f.supabase, J, profiles)).toEqual([row(J)]);
    expect(f.rpcs('match_details')).toHaveLength(1);
    expect(f.rpcs('match_details')[0].args).toEqual({
      p_job_id: J,
      p_kind: 'job',
      p_outcome: 'qualified',
    });
  });

  it('reads the job from the review list when asked', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [row(J)], error: null }) });
    await selectedRows(f.supabase, J, profiles, 'review');
    expect(f.rpcs('match_details')[0].args).toEqual({
      p_job_id: J,
      p_kind: 'job',
      p_outcome: 'review',
    });
  });

  it('reads a post role in any outcome when asked', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [row(J)], error: null }) });
    await selectedRows(f.supabase, J, profiles, null, 'post_role');
    expect(f.rpcs('match_details')[0].args).toEqual({
      p_job_id: J,
      p_kind: 'post_role',
      p_outcome: null,
    });
  });

  // The page passes its profiles still loading, so the job read runs alongside them.
  it('starts the read before the profiles are known', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [row(J), row(J, 'D')], error: null }),
    });
    let resolve!: (p: typeof profiles) => void;
    const pending = new Promise<typeof profiles>((r) => (resolve = r));
    const result = selectedRows(f.supabase, J, pending);
    expect(f.rpcs('match_details')).toHaveLength(1);
    resolve(profiles);
    expect(await result).toEqual([row(J)]);
  });

  // A closed job has no detail to show (it is dropped when grouped), so it reads as "not
  // in your matches" rather than a blank pane.
  it('is empty for a closed job', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [row(J, 'P1', true)], error: null }),
    });
    expect(await selectedRows(f.supabase, J, profiles)).toEqual([]);
  });

  it('is empty, with no read, for a job param that is not a uuid', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '22P02' } }),
    });
    for (const bad of ['gone', J.slice(0, 20), `${J}x`]) {
      expect(await selectedRows(f.supabase, bad, profiles)).toEqual([]);
    }
    expect(f.rpcs('match_details')).toHaveLength(0);
  });
});

// A decided job opened by link (a match webhook points at `/?job=<id>`) belongs on the
// Applications page: shown on Matches, its Undo would delete an earlier Applied mark.
describe('decidedJobHref', () => {
  const decided = (decisionStatus: string | null) =>
    ({ jobId: J, profileId: 'P1', closed: false, decisionStatus }) as MatchRow;

  it('is null without a job or rows', () => {
    expect(decidedJobHref(null)).toBeNull();
    expect(decidedJobHref([])).toBeNull();
  });

  it('is null for an undecided job', () => {
    expect(decidedJobHref([decided(null), decided(null)])).toBeNull();
  });

  it('opens an applied job under Applied', () => {
    expect(decidedJobHref([decided('applied')])).toBe(`/applications?job=${J}`);
  });

  it('opens a dismissed job under Not for me', () => {
    expect(decidedJobHref([decided('dismissed')])).toBe(
      `/applications?status=dismissed&job=${J}`,
    );
  });

  it('opens an expired job under Expired', () => {
    expect(decidedJobHref([decided('expired')])).toBe(
      `/applications?status=expired&job=${J}`,
    );
  });

  // A decision inherited through a linked group lives on the copy that holds it.
  it("opens the group's decided copy when it is another job", () => {
    expect(decidedJobHref([decided('applied')], 'L1')).toBe(
      '/applications?job=L1',
    );
    expect(decidedJobHref([decided('dismissed')], 'L1')).toBe(
      '/applications?status=dismissed&job=L1',
    );
  });

  it('falls back to the row when no decided copy is known', () => {
    expect(decidedJobHref([decided('applied')], null)).toBe(
      `/applications?job=${J}`,
    );
  });

  it('is null for an undecided job even with a decided copy', () => {
    expect(decidedJobHref([decided(null)], 'L1')).toBeNull();
  });
});

describe('decidedJobId', () => {
  const decided = (decisionStatus: string | null) =>
    ({ jobId: J, profileId: 'P1', closed: false, decisionStatus }) as MatchRow;

  it('reads nothing without a decided row', async () => {
    const f = fakeSupabase();
    expect(await decidedJobId(f.supabase, null)).toBeNull();
    expect(await decidedJobId(f.supabase, [decided(null)])).toBeNull();
    expect(f.rpcs('group_decision_job')).toHaveLength(0);
  });

  it("reads the group's decided job for a decided row", async () => {
    const f = fakeSupabase({ rpc: () => ({ data: 'L1', error: null }) });
    expect(await decidedJobId(f.supabase, [decided('applied')])).toBe('L1');
    expect(f.rpcs('group_decision_job')[0].args).toEqual({ p_job_id: J });
  });

  it('is null on a failed read, so the row itself is opened', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '500' } }),
    });
    expect(await decidedJobId(f.supabase, [decided('applied')])).toBeNull();
  });
});
