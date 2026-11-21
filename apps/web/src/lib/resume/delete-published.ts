import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import type { EngineClient } from '@xjobs/engine-client';

/**
 * Deletes a published profile through the engine, which releases the shared searches
 * and removes the profile's resume files itself: the storage policy forbids the web
 * app from deleting a published profile's live resume file. `not-found` counts as
 * deleted (already gone), so a retry after an engine failure works. Log lines carry
 * ids and codes only.
 */
export async function deletePublishedProfile(
  _supabase: SupabaseClient<Database>,
  _userId: string,
  profileId: string,
  engine: Pick<EngineClient, 'deleteProfile'>,
  deps: { log?: (line: string) => void } = {},
): Promise<'deleted' | 'failed'> {
  const log = deps.log ?? ((line: string) => console.warn(line));
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
