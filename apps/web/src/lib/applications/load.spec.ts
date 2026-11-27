// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMatch } from '@/lib/matches/load';
import { fakeSupabase } from '@/test/fake-supabase';
import { loadDecisions } from './load';

describe('loadDecisions', () => {
  it('reads the decision list', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [{ jobId: 'j' }], error: null }),
    });
    expect(await loadDecisions(f.supabase)).toEqual([{ jobId: 'j' }]);
    expect(f.rpcs('job_decision_list')).toHaveLength(1);
  });

  it('reads no rows as an empty list', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: null, error: null }) });
    expect(await loadDecisions(f.supabase)).toEqual([]);
  });

  it('throws through loadError on an rpc error', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '42501' } }),
    });
    await expect(loadDecisions(f.supabase)).rejects.toThrow('code=42501');
  });
});

describe('loadMatch with any outcome', () => {
  it('sends a null outcome', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    await loadMatch(f.supabase, 'j1', null);
    expect(f.rpcs('match_details')[0].args).toEqual({
      p_job_id: 'j1',
      p_kind: 'job',
      p_outcome: null,
    });
  });
});
