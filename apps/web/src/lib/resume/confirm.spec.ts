import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { describe, expect, it, vi } from 'vitest';
import { confirmResume } from './confirm';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const OLD = '44444444-4444-4444-8444-444444444444';
const NEW = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const key = (id: string) => `${U}/${P}/${id}.pdf`;
const FILENAME = 'my-secret-name.pdf';
const input = { profileId: P, key: key(NEW), filename: FILENAME };
// jsdom's Blob has no arrayBuffer(), so the fakes hand back a minimal stand-in.
const blobOf = (text: string) =>
  ({
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as unknown as Blob;
const PDF = blobOf('%PDF-1.7 body');
const uploadedAt = '2026-11-07T10:00:00Z';

type Opts = {
  download?: { data: Blob | null; error: { code?: string } | null };
  rpc?: { error: { code?: string } | null };
  row?: { data: object | null; error: { code?: string } | null };
  list?: string[];
  removeError?: { code?: string } | null;
};

function fake(o: Opts = {}) {
  const row = o.row ?? {
    data: {
      resumeKey: key(NEW),
      resumeFilename: 'clean.pdf',
      resumeSizeBytes: 13,
      resumeUploadedAt: uploadedAt,
    },
    error: null,
  };
  const bucket = {
    download: vi.fn(async () => o.download ?? { data: PDF, error: null }),
    remove: vi.fn(async () => ({ data: null, error: o.removeError ?? null })),
    list: vi.fn(async () => ({
      data: (o.list ?? [`${NEW}.pdf`]).map((name) => ({ name })),
      error: null,
    })),
  };
  const single = vi.fn(async () => row);
  const eq = vi.fn(() => ({ maybeSingle: single }));
  const select = vi.fn(() => ({ eq }));
  const supabase = {
    storage: { from: vi.fn(() => bucket) },
    rpc: vi.fn(async () => o.rpc ?? { error: null }),
    from: vi.fn(() => ({ select })),
  };
  return {
    supabase: supabase as unknown as SupabaseClient<Database>,
    raw: supabase,
    bucket,
  };
}

describe('confirmResume', () => {
  it('refuses a key for another profile before touching Storage', async () => {
    const f = fake();
    const result = await confirmResume(f.supabase, U, {
      ...input,
      key: `${U}/${OTHER}/${NEW}.pdf`,
    });
    expect(result).toEqual({ status: 'invalid', reason: 'bad-key' });
    expect(f.bucket.download).not.toHaveBeenCalled();
    expect(f.bucket.remove).not.toHaveBeenCalled();
    expect(f.raw.rpc).not.toHaveBeenCalled();
  });

  it('deletes the object and reports not-pdf', async () => {
    const f = fake({
      download: { data: blobOf('<html>'), error: null },
    });
    const result = await confirmResume(f.supabase, U, input);
    expect(result).toEqual({ status: 'invalid', reason: 'not-pdf' });
    expect(f.bucket.remove).toHaveBeenCalledWith([key(NEW)]);
    expect(f.raw.rpc).not.toHaveBeenCalled();
  });

  it('returns failed when the download errors', async () => {
    const log = vi.fn();
    const f = fake({ download: { data: null, error: { code: 'x404' } } });
    expect(await confirmResume(f.supabase, U, input, { log })).toEqual({
      status: 'failed',
    });
    expect(JSON.stringify(log.mock.calls)).toContain(P);
    expect(JSON.stringify(log.mock.calls)).toContain('x404');
    expect(JSON.stringify(log.mock.calls)).not.toContain(FILENAME);
  });

  it('saves, then removes every other file in the folder', async () => {
    const f = fake({ list: [`${OLD}.pdf`, 'stray.txt', `${NEW}.pdf`] });
    const result = await confirmResume(f.supabase, U, input);
    expect(result).toEqual({
      status: 'saved',
      resume: {
        filename: 'clean.pdf',
        sizeBytes: 13,
        uploadedAt,
      },
    });
    expect(f.raw.rpc).toHaveBeenCalledWith('set_profile_resume', {
      profile_id: P,
      key: key(NEW),
      filename: FILENAME,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(f.bucket.list).toHaveBeenCalledWith(`${U}/${P}`);
    expect(f.bucket.remove).toHaveBeenCalledWith([
      key(OLD),
      `${U}/${P}/stray.txt`,
    ]);
  });

  it('keeps the current key even if another upload won', async () => {
    const f = fake({
      list: [`${OLD}.pdf`, `${NEW}.pdf`, `${OTHER}.pdf`],
      row: {
        data: {
          resumeKey: key(OTHER),
          resumeFilename: 'o.pdf',
          resumeSizeBytes: 1,
          resumeUploadedAt: uploadedAt,
        },
        error: null,
      },
    });
    await confirmResume(f.supabase, U, input);
    expect(f.bucket.remove).toHaveBeenCalledWith([key(OLD), key(NEW)]);
  });

  it('a failed cleanup still returns saved and logs the profile id only', async () => {
    const log = vi.fn();
    const f = fake({
      list: [`${OLD}.pdf`, `${NEW}.pdf`],
      removeError: { code: 'boom' },
    });
    const result = await confirmResume(f.supabase, U, input, { log });
    expect(result.status).toBe('saved');
    expect(log).toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain(P);
    expect(logged).not.toContain(FILENAME);
    expect(logged).not.toContain(OLD);
  });

  it('an rpc error returns failed and logs the code, not the filename', async () => {
    const log = vi.fn();
    const f = fake({ rpc: { error: { code: '23514' } } });
    expect(await confirmResume(f.supabase, U, input, { log })).toEqual({
      status: 'failed',
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('23514');
    expect(logged).toContain(P);
    expect(logged).not.toContain(FILENAME);
    expect(f.bucket.remove).not.toHaveBeenCalled();
  });

  it('returns failed without cleanup when the re-read finds no row', async () => {
    const f = fake({ row: { data: null, error: null } });
    expect(await confirmResume(f.supabase, U, input, { log: vi.fn() })).toEqual(
      { status: 'failed' },
    );
    expect(f.bucket.remove).not.toHaveBeenCalled();
  });
});
