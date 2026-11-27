import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';
import { loadError } from '@/lib/setup/load';

type Client = SupabaseClient<Database>;
type Fns = Database['public']['Functions'];

export type PostExtras = Fns['post_list_extras']['Returns'][number];
export type JunkRow = Fns['post_junk_list']['Returns'][number];
export type RescueRow = Fns['post_rescue_list']['Returns'][number];
export type PostDetails = Fns['post_details']['Returns'][number];

/** Per-job extras (author, apply kinds, pending email, rescued) for the listed jobs. */
export async function loadPostExtras(
  supabase: Client,
  jobIds: string[],
): Promise<Map<string, PostExtras>> {
  if (jobIds.length === 0) return new Map();
  const r = await supabase.rpc('post_list_extras', { p_job_ids: jobIds });
  if (r.error) throw loadError('post extras read', r.error);
  return new Map((r.data ?? []).map((e) => [e.jobId, e]));
}

/** Posts the engine dropped as junk since `since`, one row per job and author. */
export async function loadJunk(
  supabase: Client,
  since: Date,
): Promise<JunkRow[]> {
  const r = await supabase.rpc('post_junk_list', {
    p_since: since.toISOString(),
  });
  if (r.error) throw loadError('post junk read', r.error);
  return r.data ?? [];
}

/** Posts the user rescued from junk, with their decision status. */
export async function loadRescues(supabase: Client): Promise<RescueRow[]> {
  const r = await supabase.rpc('post_rescue_list');
  if (r.error) throw loadError('post rescues read', r.error);
  return r.data ?? [];
}

/** One post's details; null for no id, a malformed id (Postgres would fail 22P02), no row or a failed read. */
export async function loadPostDetails(
  supabase: Client,
  jobId: string | null,
): Promise<PostDetails | null> {
  if (!jobId || !UUID.test(jobId)) return null;
  const r = await supabase.rpc('post_details', { p_job_id: jobId });
  if (r.error) {
    console.error('post details read failed', r.error.code);
    return null;
  }
  return r.data?.[0] ?? null;
}

/**
 * A post list item. `MatchedJob` does not fit junk: it holds `MatchRow`s, which carry company,
 * title, checks and decisions that a dropped post never had, so filling them would lie. Task 4
 * builds the other three tabs' items in this shape as well.
 */
export type PostListItem = {
  jobId: string;
  postedAt: Date;
  authorKey: string;
  authorName: string;
  authorUrl: string;
  postingUrl: string;
  /** Profiles the post was dropped for. */
  profileIds: string[];
  verdict: string;
  reason: string;
  confidence: string;
  text: string;
};

/** Junk rows to one item per job (profiles merged); newest posted first, then by job id. */
export function groupJunk(rows: JunkRow[]): PostListItem[] {
  const byJob = new Map<string, PostListItem>();
  for (const r of rows) {
    const item = byJob.get(r.jobId);
    if (item) {
      for (const p of r.profileIds ?? [])
        if (!item.profileIds.includes(p)) item.profileIds.push(p);
      continue;
    }
    byJob.set(r.jobId, {
      jobId: r.jobId,
      postedAt: new Date(r.postedAt ?? r.firstSeenAt),
      authorKey: r.authorKey,
      authorName: r.authorName,
      authorUrl: r.authorUrl,
      postingUrl: r.postingUrl,
      profileIds: [...(r.profileIds ?? [])],
      verdict: r.verdict,
      reason: r.reason,
      confidence: r.confidence,
      text: r.text,
    });
  }
  return [...byJob.values()].sort(
    (a, b) =>
      b.postedAt.getTime() - a.postedAt.getTime() ||
      (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0),
  );
}
