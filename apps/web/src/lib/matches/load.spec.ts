// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import { loadMatch, loadMatches } from './load';

describe('loadMatches', () => {
  it('reads all profiles since the given time', async () => {
    const now = new Date('2026-11-10T21:00:00Z');
    const since = new Date(now.getTime() - 7 * 24 * 3600_000);
    const f = fakeSupabase({
      rpc: () => ({ data: [{ jobId: 'j' }], error: null }),
    });
    const rows = await loadMatches(f.supabase, { since });
    expect(rows).toEqual([{ jobId: 'j' }]);
    expect(f.rpcs('match_details')[0].args).toEqual({
      p_since: '2026-11-03T21:00:00.000Z',
    });
  });

  it('throws through loadError on an rpc error', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '42501' } }),
    });
    await expect(
      loadMatches(f.supabase, { since: new Date() }),
    ).rejects.toThrow('code=42501');
  });
});

describe('loadMatch', () => {
  it('reads one job with no since', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    await loadMatch(f.supabase, 'j1');
    expect(f.rpcs('match_details')[0].args).toEqual({ p_job_id: 'j1' });
  });
});
