import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import type { ConfirmResult } from './confirm';
import type { confirmResumeAction } from './actions';
import { MAX_RESUME_BYTES, newResumeKey, RESUMES_BUCKET } from './key';

export async function uploadResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
  file: File,
  confirm: typeof confirmResumeAction,
): Promise<ConfirmResult> {
  // Some systems report no MIME type; then the name decides. Confirm checks the bytes.
  const looksLikePdf =
    file.type === 'application/pdf' ||
    (file.type === '' && file.name.toLowerCase().endsWith('.pdf'));
  if (!looksLikePdf) {
    return { status: 'invalid', reason: 'not-pdf' };
  }
  if (file.size > MAX_RESUME_BYTES) {
    return { status: 'invalid', reason: 'too-large' };
  }
  const key = newResumeKey(userId, profileId, crypto.randomUUID());
  const uploaded = await supabase.storage
    .from(RESUMES_BUCKET)
    .upload(key, file, { contentType: 'application/pdf', upsert: false });
  if (uploaded.error) return { status: 'failed' };
  return confirm({ profileId, key, filename: file.name });
}

export async function downloadResume(
  supabase: SupabaseClient<Database>,
  resume: { key: string; filename: string },
  save: (blob: Blob, filename: string) => void = saveBlob,
): Promise<'ok' | 'failed'> {
  const { data, error } = await supabase.storage
    .from(RESUMES_BUCKET)
    .download(resume.key);
  if (error || !data) return 'failed';
  save(data, resume.filename);
  return 'ok';
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
