import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { isResumeKeyFor, profileFolder, RESUMES_BUCKET } from './key';
import { checkPdf } from './pdf';

export type ConfirmResult =
  | {
      status: 'saved';
      resume: { filename: string; sizeBytes: number; uploadedAt: string };
    }
  | { status: 'invalid'; reason: 'not-pdf' | 'too-large' | 'bad-key' }
  | { status: 'failed' };

type Input = { profileId: string; key: string; filename: string };

// Log lines carry the profile id and an error code only: never the filename,
// the key, or file bytes.
export async function confirmResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: Input,
  deps: { log?: (line: string) => void } = {},
): Promise<ConfirmResult> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const { profileId, key, filename } = input;
  if (!isResumeKeyFor(key, userId, profileId)) {
    return { status: 'invalid', reason: 'bad-key' };
  }
  const bucket = supabase.storage.from(RESUMES_BUCKET);

  const download = await bucket.download(key);
  if (download.error || !download.data) {
    log(
      `resume confirm: download failed profile=${profileId} code=${errorCode(download.error)}`,
    );
    return { status: 'failed' };
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const checked = checkPdf(bytes);
  if (!checked.ok) {
    const removed = await bucket.remove([key]);
    if (removed.error) {
      log(
        `resume confirm: cleanup of rejected upload failed profile=${profileId} code=${errorCode(removed.error)}`,
      );
    }
    return { status: 'invalid', reason: checked.reason };
  }

  const rpc = await supabase.rpc('set_profile_resume', {
    profile_id: profileId,
    key,
    filename,
    sha256: checked.sha256,
  });
  if (rpc.error) {
    log(
      `resume confirm: set_profile_resume failed profile=${profileId} code=${errorCode(rpc.error)}`,
    );
    return { status: 'failed' };
  }

  // Re-read the current key: another confirm may have swapped after ours.
  const read = await supabase
    .from('profiles')
    .select('resumeKey, resumeFilename, resumeSizeBytes, resumeUploadedAt')
    .eq('id', profileId)
    .maybeSingle();
  const row = read.data;
  if (read.error || !row) {
    log(
      `resume confirm: re-read failed profile=${profileId} code=${errorCode(read.error)}`,
    );
    return { status: 'failed' };
  }

  const folder = profileFolder(userId, profileId);
  const listed = await bucket.list(folder);
  if (listed.error) {
    log(
      `resume confirm: cleanup list failed profile=${profileId} code=${errorCode(listed.error)}`,
    );
  } else {
    const stale = (listed.data ?? [])
      .map((file) => `${folder}/${file.name}`)
      .filter((path) => path !== row.resumeKey);
    if (stale.length > 0) {
      const removed = await bucket.remove(stale);
      if (removed.error) {
        log(
          `resume confirm: cleanup failed profile=${profileId} code=${errorCode(removed.error)}`,
        );
      }
    }
  }

  return {
    status: 'saved',
    resume: {
      filename: row.resumeFilename ?? '',
      sizeBytes: row.resumeSizeBytes ?? 0,
      uploadedAt: row.resumeUploadedAt ?? '',
    },
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; statusCode?: unknown; name?: unknown };
    for (const v of [e.code, e.statusCode, e.name]) {
      if (typeof v === 'string' && v) return v;
    }
  }
  return 'unknown_error';
}
