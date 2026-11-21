import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { profileFolder, RESUMES_BUCKET } from './key';

/**
 * Removes every resume file in the profile's Storage folder. An empty folder is fine, so a
 * retry after a partial delete succeeds. Returns the failing step with its error, or null.
 * Shared by the draft and published delete paths so both remove files identically.
 */
export async function removeProfileFiles(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
): Promise<{ what: string; error: unknown } | null> {
  const bucket = supabase.storage.from(RESUMES_BUCKET);
  const folder = profileFolder(userId, profileId);
  const listed = await bucket.list(folder);
  if (listed.error) return { what: 'list failed', error: listed.error };
  const paths = (listed.data ?? []).map((file) => `${folder}/${file.name}`);
  if (paths.length > 0) {
    const removed = await bucket.remove(paths);
    if (removed.error) {
      return { what: 'file removal failed', error: removed.error };
    }
  }
  return null;
}
