// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { describe, expect, it, vi } from 'vitest';
import { deletePublishedProfile } from './delete-published';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

function fake(
  o: { files?: string[]; listError?: { code?: string } | null } = {},
) {
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
      return { data: null, error: null };
    }),
  };
  const raw = { storage: { from: vi.fn(() => bucket) }, from: vi.fn() };
  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    bucket,
    raw,
    calls,
  };
}

const engine = (result: unknown) => ({
  deleteProfile: vi.fn(async () => {
    return result as never;
  }),
});
const quiet = { log: () => undefined };

describe('deletePublishedProfile', () => {
  it('deletes a published profile through the engine', async () => {
    const f = fake();
    const e = engine({ kind: 'ok', value: { id: P } });
    expect(await deletePublishedProfile(f.supabase, U, P, e, quiet)).toBe(
      'deleted',
    );
    expect(f.bucket.list).toHaveBeenCalledWith(`${U}/${P}`);
    expect(f.bucket.remove).toHaveBeenCalledWith([
      `${U}/${P}/a.pdf`,
      `${U}/${P}/b.pdf`,
    ]);
    expect(e.deleteProfile).toHaveBeenCalledWith(P);
    expect(f.raw.from).not.toHaveBeenCalled();
    expect(f.calls).toEqual(['list', 'remove']);
  });

  it('treats not-found as deleted', async () => {
    const f = fake();
    expect(
      await deletePublishedProfile(
        f.supabase,
        U,
        P,
        engine({ kind: 'not-found' }),
        quiet,
      ),
    ).toBe('deleted');
  });

  it('fails when the engine is unavailable and keeps the row', async () => {
    const f = fake();
    const log = vi.fn();
    for (const result of [
      { kind: 'unavailable' },
      { kind: 'unauthorized' },
      { kind: 'conflict', reason: 'not-published' },
    ]) {
      expect(
        await deletePublishedProfile(f.supabase, U, P, engine(result), { log }),
      ).toBe('failed');
    }
    expect(f.raw.from).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `published delete: engine failed profile=${P} outcome=unavailable`,
    );
  });

  it('retries after files were removed', async () => {
    const f = fake({ files: [] });
    const e = engine({ kind: 'ok', value: { id: P } });
    expect(await deletePublishedProfile(f.supabase, U, P, e, quiet)).toBe(
      'deleted',
    );
    expect(f.bucket.remove).not.toHaveBeenCalled();
    expect(e.deleteProfile).toHaveBeenCalledTimes(1);
  });

  it('fails without calling the engine when the files cannot be listed', async () => {
    const f = fake({ listError: { code: 'XX000' } });
    const e = engine({ kind: 'ok', value: { id: P } });
    expect(await deletePublishedProfile(f.supabase, U, P, e, quiet)).toBe(
      'failed',
    );
    expect(e.deleteProfile).not.toHaveBeenCalled();
  });
});
