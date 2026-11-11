// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import type { MatchRow } from './group';
import { selectedRows } from './selected';

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
    expect(f.rpcs('match_details')[0].args).toEqual({ p_job_id: J });
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
