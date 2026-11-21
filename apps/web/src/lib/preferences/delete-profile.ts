import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from '@/lib/resume/errors';
import type { EngineClient } from '@xjobs/engine-client';
import { deleteDraftProfile } from '@/lib/resume/delete-draft';
import { deletePublishedProfile } from '@/lib/resume/delete-published';
import type { ProfileListItem } from './profiles';

type Deps = {
  log?: (line: string) => void;
  /** Injected in tests; the real `deleteDraftProfile` otherwise. */
  deleteDraft?: typeof deleteDraftProfile;
  /** Injected in tests; the real `deletePublishedProfile` otherwise. */
  deletePublished?: typeof deletePublishedProfile;
  /** Needed to delete a published profile. */
  engine?: Pick<EngineClient, 'deleteProfile'>;
};

/**
 * Deletes one of the user's profiles, never the last one and never the only one with a
 * resume (setup stays done once any profile has a resume), for drafts and published
 * profiles alike. A draft is `deleteDraftProfile`'s; a published profile goes through the
 * engine (`deletePublishedProfile`). Files are removed first on both paths. Log lines carry ids and error codes only.
 */
export async function deleteProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
  deps: Deps = {},
): Promise<'deleted' | 'last' | 'only-resume' | 'failed'> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const read = await supabase.from('profiles').select('id, resumeKey, state');
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
  if (target?.state === 'published') {
    if (!deps.engine) {
      log(`profile delete: no engine client profile=${profileId}`);
      return 'failed';
    }
    return (deps.deletePublished ?? deletePublishedProfile)(
      supabase,
      userId,
      profileId,
      deps.engine,
    );
  }
  const result = await (deps.deleteDraft ?? deleteDraftProfile)(
    supabase,
    userId,
    profileId,
  );
  // The state was read a moment ago: a draft that is no longer one is a stale read.
  return result === 'not-draft' ? 'failed' : result;
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
