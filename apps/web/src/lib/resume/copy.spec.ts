// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { describe, expect, it, vi } from 'vitest';
import type { confirmResume } from './confirm';
import { copyResume } from './copy';

const U = '11111111-1111-4111-8111-111111111111';
const FROM = '22222222-2222-4222-8222-222222222222';
const TO = '33333333-3333-4333-8333-333333333333';
const SOURCE_KEY = `${U}/${FROM}/44444444-4444-4444-8444-444444444444.pdf`;
const FILENAME = 'my-secret-name.pdf';
const SAVED = {
  status: 'saved' as const,
  resume: { filename: FILENAME, sizeBytes: 13, uploadedAt: 'now' },
};
const blob = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob;

type Opts = {
  row?: { data: object | null; error: { code?: string } | null };
  copyError?: { statusCode?: string } | null;
  downloadError?: { statusCode?: string } | null;
  uploadError?: { statusCode?: string } | null;
};

function fake(o: Opts = {}) {
  const row = o.row ?? {
    data: { resumeKey: SOURCE_KEY, resumeFilename: FILENAME },
    error: null,
  };
  const bucket = {
    copy: vi.fn(async (_from: string, to: string) => ({
      data: o.copyError ? null : { path: to },
      error: o.copyError ?? null,
    })),
    download: vi.fn(async () => ({
      data: o.downloadError ? null : blob,
      error: o.downloadError ?? null,
    })),
    upload: vi.fn(async (path: string) => ({
      data: o.uploadError ? null : { path },
      error: o.uploadError ?? null,
    })),
  };
  const maybeSingle = vi.fn(async () => row);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const raw = {
    storage: { from: vi.fn(() => bucket) },
    from: vi.fn(() => ({ select })),
  };
  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    raw,
    bucket,
    eq,
  };
}

const newKey = new RegExp(`^${U}/${TO}/[0-9a-f-]{36}\\.pdf$`);

describe('copyResume', () => {
  it('a source without a resume is none and touches no file', async () => {
    const f = fake({
      row: { data: { resumeKey: null, resumeFilename: null }, error: null },
    });
    const confirm = vi.fn<typeof confirmResume>();
    expect(
      await copyResume(f.supabase, U, FROM, TO, { log: () => undefined, confirm }),
    ).toEqual({ status: 'none' });
    expect(f.bucket.copy).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a source RLS does not return is none', async () => {
    const f = fake({ row: { data: null, error: null } });
    expect(
      await copyResume(f.supabase, U, FROM, TO, { log: () => undefined }),
    ).toEqual({ status: 'none' });
  });

  it('copies into the new profile folder and confirms it', async () => {
    const f = fake();
    const confirm = vi.fn<typeof confirmResume>(async () => SAVED);
    expect(
      await copyResume(f.supabase, U, FROM, TO, { log: () => undefined, confirm }),
    ).toEqual(SAVED);
    expect(f.eq).toHaveBeenCalledWith('id', FROM);
    expect(f.raw.storage.from).toHaveBeenCalledWith('resumes');
    const [from, to] = f.bucket.copy.mock.calls[0];
    expect(from).toBe(SOURCE_KEY);
    expect(to).toMatch(newKey);
    expect(f.bucket.upload).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      f.supabase,
      U,
      { profileId: TO, key: to, filename: FILENAME },
      expect.anything(),
    );
  });

  it('a refused copy falls back to download and upload', async () => {
    const log = vi.fn();
    const f = fake({ copyError: { statusCode: '403' } });
    const confirm = vi.fn<typeof confirmResume>(async () => SAVED);
    expect(await copyResume(f.supabase, U, FROM, TO, { log, confirm })).toEqual(
      SAVED,
    );
    expect(f.bucket.download).toHaveBeenCalledWith(SOURCE_KEY);
    const [path, body, options] = f.bucket.upload.mock.calls[0] as unknown as [
      string,
      Blob,
      object,
    ];
    expect(path).toMatch(newKey);
    expect(body).toBe(blob);
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false });
    expect(confirm.mock.calls[0][2]).toEqual({
      profileId: TO,
      key: path,
      filename: FILENAME,
    });
  });

  it('a failed fallback fails without confirming', async () => {
    const confirm = vi.fn<typeof confirmResume>();
    const down = fake({
      copyError: { statusCode: '403' },
      downloadError: { statusCode: '404' },
    });
    expect(
      await copyResume(down.supabase, U, FROM, TO, { log: () => undefined, confirm }),
    ).toEqual({ status: 'failed' });
    const up = fake({
      copyError: { statusCode: '403' },
      uploadError: { statusCode: '400' },
    });
    expect(
      await copyResume(up.supabase, U, FROM, TO, { log: () => undefined, confirm }),
    ).toEqual({ status: 'failed' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a source read error fails', async () => {
    const f = fake({ row: { data: null, error: { code: 'XX000' } } });
    expect(
      await copyResume(f.supabase, U, FROM, TO, { log: () => undefined }),
    ).toEqual({ status: 'failed' });
  });

  it('logs carry ids and codes, never keys or filenames', async () => {
    const log = vi.fn();
    const f = fake({
      copyError: { statusCode: '403' },
      uploadError: { statusCode: '400' },
    });
    await copyResume(f.supabase, U, FROM, TO, { log });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('403');
    expect(lines.join('\n')).toContain(TO);
    for (const line of lines) {
      expect(line).not.toContain(SOURCE_KEY);
      expect(line).not.toContain('.pdf');
      expect(line).not.toContain(FILENAME);
    }
  });
});
