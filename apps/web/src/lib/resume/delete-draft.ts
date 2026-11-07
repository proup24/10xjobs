import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from './errors';
import { profileFolder, RESUMES_BUCKET } from './key';

// Log lines carry the profile id and an error code only.
export async function deleteDraftProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
  deps: { log?: (line: string) => void } = {},
): Promise<'deleted' | 'not-draft' | 'failed'> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const fail = (what: string, error: unknown) => {
    log(
      `resume draft delete: ${what} profile=${profileId} code=${errorCode(error)}`,
    );
    return 'failed' as const;
  };

  const read = await supabase
    .from('profiles')
    .select('id, state')
    .eq('id', profileId)
    .maybeSingle();
  if (read.error || !read.data) return fail('state read failed', read.error);
  if (read.data.state !== 'draft') return 'not-draft';

  const bucket = supabase.storage.from(RESUMES_BUCKET);
  const id = read.data.id;
  const folder = profileFolder(userId, id);
  const listed = await bucket.list(folder);
  if (listed.error) return fail('list failed', listed.error);
  const paths = (listed.data ?? []).map((file) => `${folder}/${file.name}`);
  if (paths.length > 0) {
    const removed = await bucket.remove(paths);
    if (removed.error) return fail('file removal failed', removed.error);
  }

  const deleted = await supabase
    .from('profiles')
    .delete()
    .eq('id', id)
    .eq('state', 'draft')
    .select('id');
  if (deleted.error || !deleted.data || deleted.data.length === 0) {
    return fail('row delete failed', deleted.error);
  }
  return 'deleted';
}
