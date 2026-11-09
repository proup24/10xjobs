import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from '@/lib/resume/errors';
import { deleteDraftProfile } from '@/lib/resume/delete-draft';
import type { ProfileListItem } from './profiles';

type Deps = {
  log?: (line: string) => void;
  /** Injected in tests; the real `deleteDraftProfile` otherwise. */
  deleteDraft?: typeof deleteDraftProfile;
};

/**
 * Deletes one of the user's profiles, never the last one and never the only one with a
 * resume (setup stays done once any profile has a resume). The delete itself, files
 * included, is `deleteDraftProfile`'s. Log lines carry ids and error codes only.
 */
export async function deleteProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
  deps: Deps = {},
): Promise<'deleted' | 'last' | 'only-resume' | 'not-draft' | 'failed'> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const read = await supabase.from('profiles').select('id, resumeKey');
  if (read.error || !read.data) {
    log(
      `profile delete: profiles read failed profile=${profileId} code=${errorCode(read.error)}`,
    );
    return 'failed';
  }
  if (read.data.length <= 1) return 'last';
  const target = read.data.find((r) => r.id === profileId);
  const otherWithResume = read.data.some(
    (r) => r.id !== profileId && r.resumeKey !== null,
  );
  if (target?.resumeKey != null && !otherWithResume) return 'only-resume';
  return (deps.deleteDraft ?? deleteDraftProfile)(supabase, userId, profileId);
}

/**
 * Where to land after deleting `deletedId` from `list` (creation order): the profile
 * that followed it, else the last remaining one, else the contacts section.
 */
export function hrefAfterDelete(
  list: ProfileListItem[],
  deletedId: string,
): string {
  const index = list.findIndex((p) => p.id === deletedId);
  const remaining = list.filter((p) => p.id !== deletedId);
  const target =
    (index >= 0 ? remaining[index] : undefined) ??
    remaining[remaining.length - 1];
  if (!target) return '/preferences/contacts';
  return `/preferences/profiles/${target.id}/${target.hasResume ? 'job' : 'resume'}`;
}
