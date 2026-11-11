// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import type { MatchRow } from './group';
import { selectedRows } from './selected';

const J = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = (jobId: string, profileId = 'P1') =>
  ({ jobId, profileId }) as MatchRow;
const profiles = [
  { id: 'P1', state: 'published' as const },
  { id: 'D', state: 'draft' as const },
];

describe('selectedRows', () => {
  it('is null without a job', async () => {
    const f = fakeSupabase();
    expect(await selectedRows(f.supabase, null, [], profiles)).toBeNull();
    expect(f.rpcs('match_details')).toHaveLength(0);
  });

  it("takes the job's rows from the loaded window without a read", async () => {
    const f = fakeSupabase();
    const live = [row(J), row(OUT)];
    expect(await selectedRows(f.supabase, J, live, profiles)).toEqual([row(J)]);
    expect(f.rpcs('match_details')).toHaveLength(0);
  });

  it('reads a job outside the window, published profiles only', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [row(OUT), row(OUT, 'D')], error: null }),
    });
    expect(await selectedRows(f.supabase, OUT, [], profiles)).toEqual([
      row(OUT),
    ]);
    expect(f.rpcs('match_details')[0].args).toEqual({ p_job_id: OUT });
  });

  it('is empty, with no read, for a job param that is not a uuid', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '22P02' } }),
    });
    for (const bad of ['gone', J.slice(0, 20), `${J}x`]) {
      expect(await selectedRows(f.supabase, bad, [], profiles)).toEqual([]);
    }
    expect(f.rpcs('match_details')).toHaveLength(0);
  });
});
