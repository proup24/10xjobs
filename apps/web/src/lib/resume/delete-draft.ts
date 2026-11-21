import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from './errors';
import { removeProfileFiles } from './remove-profile-files';

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

  const id = read.data.id;
  const removed = await removeProfileFiles(supabase, userId, id);
  if (removed) return fail(removed.what, removed.error);

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
