import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';

type Row = Database['public']['Functions']['job_postings']['Returns'][number];

/**
 * One posting behind a job, shown first. The generated row type says these four are
 * non-null, but they are nullable in Postgres, so they are widened here.
 */
export type JobPosting = Omit<
  Row,
  'title' | 'location' | 'postedAt' | 'postingUrl'
> & {
  title: string | null;
  location: string | null;
  postedAt: string | null;
  postingUrl: string | null;
};

/**
 * The postings merged into a job (one row when it has a single posting). Empty without a
 * job, for a malformed id (the uuid argument would refuse it) and on a read error, which is
 * logged and never thrown: a failed read hides the section and doesn't break the page.
 */
export async function loadPostings(
  supabase: SupabaseClient<Database>,
  jobId: string | null,
): Promise<JobPosting[]> {
  if (!jobId || !UUID.test(jobId)) return [];
  const r = await supabase.rpc('job_postings', { p_job_id: jobId });
  if (r.error) {
    console.error('job postings read failed', r.error.code);
    return [];
  }
  return r.data ?? [];
}
