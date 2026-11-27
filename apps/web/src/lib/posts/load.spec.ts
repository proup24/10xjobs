// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import {
  groupJunk,
  matchedJobItems,
  rescueItems,
  loadJunk,
  loadPostDetails,
  loadPostExtras,
  loadRescues,
} from './load';

const J1 = '11111111-1111-4111-8111-111111111111';

describe('loadPostExtras', () => {
  it('reads extras by job id, keyed by job', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [{ jobId: J1, rescued: false }], error: null }),
    });
    const m = await loadPostExtras(f.supabase, [J1]);
    expect(f.rpcs('post_list_extras')[0].args).toEqual({ p_job_ids: [J1] });
    expect(m.get(J1)).toMatchObject({ rescued: false });
  });

  it('skips the call for an empty list', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    expect((await loadPostExtras(f.supabase, [])).size).toBe(0);
    expect(f.rpcs('post_list_extras')).toHaveLength(0);
  });

  it('throws through loadError', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: '42501' } }),
    });
    await expect(loadPostExtras(f.supabase, [J1])).rejects.toThrow(
      'code=42501',
    );
  });
});

describe('loadJunk and loadRescues', () => {
  it('reads junk since a time', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [{ jobId: 'a' }], error: null }),
    });
    const rows = await loadJunk(f.supabase, new Date('2026-11-03T21:00:00Z'));
    expect(rows).toEqual([{ jobId: 'a' }]);
    expect(f.rpcs('post_junk_list')[0].args).toEqual({
      p_since: '2026-11-03T21:00:00.000Z',
    });
  });

  it('reads rescues and throws on error', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    expect(await loadRescues(f.supabase)).toEqual([]);
    const g = fakeSupabase({
      rpc: () => ({ data: null, error: { code: 'X1' } }),
    });
    await expect(loadRescues(g.supabase)).rejects.toThrow('code=X1');
    await expect(loadJunk(g.supabase, new Date())).rejects.toThrow('code=X1');
  });
});

describe('loadPostDetails', () => {
  it('returns null for no id or a non-uuid, with no call', async () => {
    const f = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    expect(await loadPostDetails(f.supabase, null)).toBeNull();
    expect(await loadPostDetails(f.supabase, 'not-a-uuid')).toBeNull();
    expect(f.rpcs('post_details')).toHaveLength(0);
  });

  it('returns the single row, or null for none', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: [{ jobId: J1 }], error: null }),
    });
    expect(await loadPostDetails(f.supabase, J1)).toEqual({ jobId: J1 });
    expect(f.rpcs('post_details')[0].args).toEqual({ p_job_id: J1 });
    const g = fakeSupabase({ rpc: () => ({ data: [], error: null }) });
    expect(await loadPostDetails(g.supabase, J1)).toBeNull();
  });

  it('logs and returns null on an error', async () => {
    const f = fakeSupabase({
      rpc: () => ({ data: null, error: { code: 'X1' } }),
    });
    expect(await loadPostDetails(f.supabase, J1)).toBeNull();
  });
});

describe('groupJunk', () => {
  const row = (jobId: string, postedAt: string, profileIds: string[]) =>
    ({
      jobId,
      postedAt,
      firstSeenAt: postedAt,
      profileIds,
      authorKey: 'k',
      authorName: 'A',
      authorUrl: 'u',
      confidence: 'high',
      postingUrl: 'p',
      reason: 'r',
      text: 't',
      verdict: 'not_a_job',
    }) as never;
  it('merges rows of a job and sorts newest first', () => {
    const items = groupJunk([
      row('a', '2026-11-01T00:00:00Z', ['p1']),
      row('b', '2026-11-02T00:00:00Z', ['p1']),
      row('a', '2026-11-01T00:00:00Z', ['p2']),
    ]);
    expect(items.map((i) => i.jobId)).toEqual(['b', 'a']);
    expect(items[1].profileIds).toEqual(['p1', 'p2']);
    expect(items[1].postedAt).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('handles null postedAt (falls back to firstSeenAt) and null profileIds', () => {
    const r = { ...(row('n', '2026-11-05T00:00:00Z', []) as object) } as never;
    const items = groupJunk([
      { ...(r as object), postedAt: null, profileIds: null } as never,
    ]);
    expect(items[0].postedAt).toEqual(new Date('2026-11-05T00:00:00Z'));
    expect(items[0].firstSeenAt).toEqual(new Date('2026-11-05T00:00:00Z'));
    expect(items[0].profileIds).toEqual([]);
    expect(items[0].junk).toEqual({
      verdict: 'not_a_job',
      reason: 'r',
      confidence: 'high',
    });
  });
});

describe('rescueItems', () => {
  const rr = (o: object) =>
    ({
      jobId: 'a',
      authorName: 'A',
      companyName: 'Co',
      decisionStatus: null,
      firstSeenAt: '2026-11-01T00:00:00Z',
      kind: 'post_role',
      origin: 'junk',
      postedAt: '2026-11-02T00:00:00Z',
      postingUrl: 'p',
      profileIds: ['p1'],
      title: 'Eng',
      ...o,
    }) as never;
  it('maps rescue rows, merging and sorting', () => {
    const items = rescueItems([
      rr({}),
      rr({ profileIds: ['p1', 'p2'] }),
      rr({ jobId: 'b', postedAt: '2026-11-03T00:00:00Z' }),
    ]);
    expect(items.map((i) => i.jobId)).toEqual(['b', 'a']);
    expect(items[1]).toMatchObject({
      title: 'Eng',
      companyName: 'Co',
      rescueOrigin: 'junk',
      profileIds: ['p1', 'p2'],
      junk: null,
    });
  });
  it('handles null postedAt and null profileIds', () => {
    const [i] = rescueItems([rr({ postedAt: null, profileIds: null })]);
    expect(i.postedAt).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(i.profileIds).toEqual([]);
  });
});

describe('matchedJobItems', () => {
  it('maps a matched job, one profile id per row', () => {
    const rows = [
      {
        profileId: 'p1',
        title: 'T',
        companyName: 'C',
        kind: 'post_role',
        postingUrl: 'u',
        decisionStatus: 'applied',
        firstSeenAt: '2026-11-01T00:00:00Z',
        posterName: 'P',
      },
      { profileId: 'p2' },
      { profileId: 'p1' },
    ];
    const postedAt = new Date('2026-11-02T00:00:00Z');
    const [i] = matchedJobItems([{ jobId: 'j', rows, postedAt } as never]);
    expect(i).toMatchObject({
      jobId: 'j',
      title: 'T',
      companyName: 'C',
      kind: 'post_role',
      decisionStatus: 'applied',
      authorName: 'P',
      profileIds: ['p1', 'p2'],
      postedAt,
      firstSeenAt: new Date('2026-11-01T00:00:00Z'),
    });
  });
  it('handles null postedAt-like gaps: no firstSeenAt falls back to postedAt', () => {
    const postedAt = new Date('2026-11-02T00:00:00Z');
    const [i] = matchedJobItems([
      { jobId: 'j', rows: [{ profileId: null }], postedAt } as never,
    ]);
    expect(i.firstSeenAt).toEqual(postedAt);
    expect(i.profileIds).toEqual([]);
  });
});
