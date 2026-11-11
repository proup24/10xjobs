import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';

/**
 * Records that the user opened a job's post or apply link. The first view wins, so a
 * repeat click keeps the original time. A failed write is logged, never thrown: the link
 * has already opened.
 */
export async function markViewed(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobId: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('job_views')
      .upsert(
        { userId, jobId },
        { onConflict: 'userId,jobId', ignoreDuplicates: true },
      );
    if (error) console.error('Could not mark the job viewed', error);
  } catch (error) {
    console.error('Could not mark the job viewed', error);
  }
}
