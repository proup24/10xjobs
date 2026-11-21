import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import type { EngineClient } from '@xjobs/engine-client';
import { errorCode } from './errors';
import { removeProfileFiles } from './remove-profile-files';

/**
 * Deletes a published profile: its resume files first, exactly as `deleteDraftProfile`
 * does, then the row through the engine (which releases the shared searches in one
 * transaction). Files already gone is fine, so a retry after an engine failure works.
 * `not-found` counts as deleted (already gone). Log lines carry ids and codes only.
 */
export async function deletePublishedProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  profileId: string,
  engine: Pick<EngineClient, 'deleteProfile'>,
  deps: { log?: (line: string) => void } = {},
): Promise<'deleted' | 'failed'> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const removed = await removeProfileFiles(supabase, userId, profileId);
  if (removed) {
    log(
      `published delete: ${removed.what} profile=${profileId} code=${errorCode(removed.error)}`,
    );
    return 'failed';
  }
  let result: Awaited<ReturnType<EngineClient['deleteProfile']>>;
  try {
    result = await engine.deleteProfile(profileId);
  } catch {
    log(`published delete: engine threw profile=${profileId}`);
    return 'failed';
  }
  if (result.kind === 'ok' || result.kind === 'not-found') return 'deleted';
  log(
    `published delete: engine failed profile=${profileId} outcome=${result.kind}`,
  );
  return 'failed';
}
