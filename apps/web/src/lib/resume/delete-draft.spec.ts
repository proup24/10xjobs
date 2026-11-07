import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { describe, expect, it, vi } from 'vitest';
import { deleteDraftProfile } from './delete-draft';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

type Opts = {
  state?: { data: object | null; error: { code?: string } | null };
  files?: string[];
  listError?: { code?: string } | null;
  removeError?: { code?: string } | null;
  deleted?: { data: object[] | null; error: { code?: string } | null };
};

function fake(o: Opts = {}) {
  const calls: string[] = [];
  const bucket = {
    list: vi.fn(async () => {
      calls.push('list');
      return {
        data: (o.files ?? ['a.pdf', 'b.pdf']).map((name) => ({ name })),
        error: o.listError ?? null,
      };
    }),
    remove: vi.fn(async () => {
      calls.push('remove');
      return { data: null, error: o.removeError ?? null };
    }),
  };
  const maybeSingle = vi.fn(
    async () => o.state ?? { data: { state: 'draft' }, error: null },
  );
  const select1 = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  const select2 = vi.fn(async () => {
    calls.push('delete');
    return o.deleted ?? { data: [{ id: P }], error: null };
  });
  const eq2 = vi.fn(() => ({ select: select2 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  const raw = {
    storage: { from: vi.fn(() => bucket) },
    from: vi.fn(() => ({ select: select1, delete: del })),
  };
  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    bucket,
    del,
    calls,
  };
}

const quiet = { log: () => undefined };

describe('deleteDraftProfile', () => {
  it('returns not-draft and touches nothing for a published profile', async () => {
    const f = fake({ state: { data: { state: 'published' }, error: null } });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('not-draft');
    expect(f.bucket.list).not.toHaveBeenCalled();
    expect(f.bucket.remove).not.toHaveBeenCalled();
    expect(f.del).not.toHaveBeenCalled();
  });

  it('a missing row or state read error returns failed and touches nothing', async () => {
    for (const state of [
      { data: null, error: null },
      { data: null, error: { code: 'X' } },
    ]) {
      const f = fake({ state });
      expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('failed');
      expect(f.calls).toEqual([]);
    }
  });

  it('removes every file in the folder, then deletes the row', async () => {
    const f = fake();
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('deleted');
    expect(f.bucket.list).toHaveBeenCalledWith(`${U}/${P}`);
    expect(f.bucket.remove).toHaveBeenCalledWith([
      `${U}/${P}/a.pdf`,
      `${U}/${P}/b.pdf`,
    ]);
    expect(f.calls).toEqual(['list', 'remove', 'delete']);
  });

  it('an empty folder skips remove and still deletes the row', async () => {
    const f = fake({ files: [] });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('deleted');
    expect(f.calls).toEqual(['list', 'delete']);
  });

  it('a list error stops before any remove or row delete', async () => {
    const f = fake({ listError: { code: 'L' } });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('failed');
    expect(f.calls).toEqual(['list']);
  });

  it('a failed row delete after the files are gone returns failed', async () => {
    const f = fake({ deleted: { data: null, error: { code: 'D' } } });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('failed');
    expect(f.calls).toEqual(['list', 'remove', 'delete']);
  });

  it('an empty delete result returns failed', async () => {
    const f = fake({ deleted: { data: [], error: null } });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('failed');
  });

  it('a failed file removal stops before deleting the row', async () => {
    const f = fake({ removeError: { code: 'R' } });
    expect(await deleteDraftProfile(f.supabase, U, P, quiet)).toBe('failed');
    expect(f.calls).toEqual(['list', 'remove']);
  });
});
