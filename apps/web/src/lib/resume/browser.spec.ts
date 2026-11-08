// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { describe, expect, it, vi } from 'vitest';
import { downloadResume, uploadResume } from './browser';
import { isResumeKeyFor, MAX_RESUME_BYTES } from './key';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

function fake(
  o: { uploadError?: { message: string } | null; download?: object } = {},
) {
  const bucket = {
    upload: vi.fn(async () => ({ data: null, error: o.uploadError ?? null })),
    download: vi.fn(
      async () => o.download ?? { data: new Blob(['x']), error: null },
    ),
    createSignedUrl: vi.fn(),
  };
  const raw = { storage: { from: vi.fn(() => bucket) } };
  return { supabase: raw as unknown as SupabaseClient<Database>, raw, bucket };
}

const pdf = (name = 'cv.pdf') =>
  new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const saved = {
  status: 'saved',
  resume: { filename: 'cv.pdf', sizeBytes: 8, uploadedAt: 't' },
} as const;

describe('uploadResume', () => {
  it('refuses a non-PDF or oversize file without uploading', async () => {
    const f = fake();
    const confirm = vi.fn();
    const text = new File(['hi'], 'a.txt', { type: 'text/plain' });
    expect(await uploadResume(f.supabase, U, P, text, confirm)).toEqual({
      status: 'invalid',
      reason: 'not-pdf',
    });
    const big = pdf();
    Object.defineProperty(big, 'size', { value: MAX_RESUME_BYTES + 1 });
    expect(await uploadResume(f.supabase, U, P, big, confirm)).toEqual({
      status: 'invalid',
      reason: 'too-large',
    });
    expect(f.bucket.upload).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uploads to a key under the user's profile folder with upsert false, then confirms with the original filename", async () => {
    const f = fake();
    const confirm = vi.fn(async () => saved);
    const file = pdf('My CV.pdf');
    const result = await uploadResume(f.supabase, U, P, file, confirm);
    expect(result).toEqual(saved);
    const [key, body, options] = f.bucket.upload.mock.calls[0] as unknown as [
      string,
      File,
      object,
    ];
    expect(isResumeKeyFor(key, U, P)).toBe(true);
    expect(body).toBe(file);
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false });
    expect(confirm).toHaveBeenCalledWith({
      profileId: P,
      key,
      filename: 'My CV.pdf',
    });
  });

  it('an upload error returns failed and never confirms', async () => {
    const f = fake({ uploadError: { message: 'boom' } });
    const confirm = vi.fn();
    expect(await uploadResume(f.supabase, U, P, pdf(), confirm)).toEqual({
      status: 'failed',
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('downloadResume', () => {
  const resume = {
    key: `${U}/${P}/33333333-3333-4333-8333-333333333333.pdf`,
    filename: 'cv.pdf',
  };

  it('passes the blob and the filename to save, and creates no signed URL', async () => {
    const blob = new Blob(['x']);
    const f = fake({ download: { data: blob, error: null } });
    const save = vi.fn();
    expect(await downloadResume(f.supabase, resume, save)).toBe('ok');
    expect(f.bucket.download).toHaveBeenCalledWith(resume.key);
    expect(save).toHaveBeenCalledWith(blob, 'cv.pdf');
    expect(f.bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('a download error returns failed without saving', async () => {
    const f = fake({ download: { data: null, error: { message: 'x' } } });
    const save = vi.fn();
    expect(await downloadResume(f.supabase, resume, save)).toBe('failed');
    expect(save).not.toHaveBeenCalled();
  });
});
