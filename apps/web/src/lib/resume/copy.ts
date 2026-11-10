import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { confirmResume, type ConfirmResult } from './confirm';
import { errorCode } from './errors';
import { newResumeKey, RESUMES_BUCKET } from './key';

type Deps = {
  log?: (line: string) => void;
  now?: () => number;
  /** Injected in tests; the real `confirmResume` otherwise. */
  confirm?: typeof confirmResume;
};

/**
 * Copies one profile's resume into a fresh key in another profile's folder, as the user,
 * then confirms it like an upload: `confirmResume` re-checks ownership of the key, the PDF
 * signature and the size on the stored bytes, and records it on the profile. A source
 * without a resume (or one RLS doesn't return) is `none`.
 *
 * Log lines carry profile ids and error codes only: never keys or filenames.
 */
export async function copyResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  fromProfileId: string,
  toProfileId: string,
  deps: Deps = {},
): Promise<ConfirmResult | { status: 'none' }> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const confirm = deps.confirm ?? confirmResume;
  const fail = (what: string, error: unknown) => {
    log(
      `resume copy: ${what} from=${fromProfileId} profile=${toProfileId} code=${errorCode(error)}`,
    );
    return { status: 'failed' as const };
  };

  const read = await supabase
    .from('profiles')
    .select('resumeKey, resumeFilename')
    .eq('id', fromProfileId)
    .maybeSingle();
  if (read.error) return fail('source read failed', read.error);
  const source = read.data?.resumeKey;
  if (!source) return { status: 'none' };
  const filename = read.data?.resumeFilename ?? 'resume.pdf';

  const key = newResumeKey(userId, toProfileId);
  const bucket = supabase.storage.from(RESUMES_BUCKET);
  const copied = await bucket.copy(source, key);
  if (copied.error) {
    log(
      `resume copy: copy refused, re-uploading from=${fromProfileId} profile=${toProfileId} code=${errorCode(copied.error)}`,
    );
    const download = await bucket.download(source);
    if (download.error || !download.data) {
      return fail('download failed', download.error);
    }
    const upload = await bucket.upload(key, download.data, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upload.error) return fail('upload failed', upload.error);
  }

  return confirm(
    supabase,
    userId,
    { profileId: toProfileId, key, filename },
    { log, ...(deps.now ? { now: deps.now } : {}) },
  );
}
