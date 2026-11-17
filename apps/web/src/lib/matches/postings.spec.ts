// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import { loadPostings } from './postings';

const JOB = '3f2a1c9e-8b7d-4e6f-9a5b-1c2d3e4f5a6b';

afterEach(() => vi.restoreAllMocks());

describe('loadPostings', () => {
  it('returns [] without a job', async () => {
    const f = fakeSupabase();
    expect(await loadPostings(f.supabase, null)).toEqual([]);
    expect(f.rpcs('job_postings')).toHaveLength(0);
  });

  it('returns [] for a malformed id without reading', async () => {
    const f = fakeSupabase();
    expect(await loadPostings(f.supabase, 'nope')).toEqual([]);
    expect(f.rpcs('job_postings')).toHaveLength(0);
  });

  it('returns the rows', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [{ rawItemId: 'r1' }], error: null }),
    });
    expect(await loadPostings(f.supabase, JOB)).toEqual([{ rawItemId: 'r1' }]);
    expect(f.rpcs('job_postings')[0].args).toEqual({ p_job_id: JOB });
  });

  it('returns [] when the read fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '42501' } }),
    });
    expect(await loadPostings(f.supabase, JOB)).toEqual([]);
    expect(log).toHaveBeenCalled();
  });
});
