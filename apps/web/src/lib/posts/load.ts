import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';
import type { MatchedJob } from '@/lib/matches/group';
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
 * One post row on any of the four tabs, whatever its source (a match row, a rescue or a junk
 * row). Tab-specific parts are null elsewhere. `MatchedJob` stays the input of `MatchList`; the
 * mappers below turn each tab's data into this one shape so Task 4 filters and sorts one type.
 */
export type PostListItem = {
  jobId: string;
  kind: string | null;
  title: string | null;
  companyName: string | null;
  postingUrl: string | null;
  /** Effective posted time; falls back to `firstSeenAt` when the post has none. */
  postedAt: Date;
  /** The 24h/7d filter on Junk uses this. */
  firstSeenAt: Date;
  profileIds: string[];
  decisionStatus: string | null;
  authorName: string | null;
  /** Junk only. */
  junk: { verdict: string; reason: string; confidence: string } | null;
  /** Rescues only: where the rescued post came from. */
  rescueOrigin: string | null;
  /** The grouped match rows behind the item (the row layout, failed checks); null for Junk and a rescue with no row. */
  job: MatchedJob | null;
  /** The newest decision of the item's match rows; Disqualified sorts on it. */
  decidedAt: Date | null;
};

function newestFirst(a: PostListItem, b: PostListItem): number {
  return (
    b.postedAt.getTime() - a.postedAt.getTime() ||
    (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0)
  );
}

function mergeProfiles(into: string[], more: string[] | null | undefined) {
  for (const p of more ?? []) if (p && !into.includes(p)) into.push(p);
}

/** Junk rows to one item per job (profiles merged); newest posted first, then by job id. */
export function groupJunk(rows: JunkRow[]): PostListItem[] {
  const byJob = new Map<string, PostListItem>();
  for (const r of rows) {
    const item = byJob.get(r.jobId);
    if (item) {
      mergeProfiles(item.profileIds, r.profileIds);
      continue;
    }
    const firstSeenAt = new Date(r.firstSeenAt);
    byJob.set(r.jobId, {
      jobId: r.jobId,
      kind: null,
      title: null,
      companyName: null,
      postingUrl: r.postingUrl ?? null,
      postedAt: r.postedAt ? new Date(r.postedAt) : firstSeenAt,
      firstSeenAt,
      profileIds: [...(r.profileIds ?? [])],
      decisionStatus: null,
      authorName: r.authorName ?? null,
      junk: { verdict: r.verdict, reason: r.reason, confidence: r.confidence },
      rescueOrigin: null,
      job: null,
      decidedAt: null,
    });
  }
  return [...byJob.values()].sort(newestFirst);
}

/** Rescue rows to one item per job; newest first. */
export function rescueItems(rows: RescueRow[]): PostListItem[] {
  const byJob = new Map<string, PostListItem>();
  for (const r of rows) {
    const item = byJob.get(r.jobId);
    if (item) {
      mergeProfiles(item.profileIds, r.profileIds);
      continue;
    }
    const firstSeenAt = new Date(r.firstSeenAt);
    byJob.set(r.jobId, {
      jobId: r.jobId,
      kind: r.kind ?? null,
      title: r.title ?? null,
      companyName: r.companyName ?? null,
      postingUrl: r.postingUrl ?? null,
      postedAt: r.postedAt ? new Date(r.postedAt) : firstSeenAt,
      firstSeenAt,
      profileIds: [...(r.profileIds ?? [])],
      decisionStatus: r.decisionStatus ?? null,
      authorName: r.authorName ?? null,
      junk: null,
      rescueOrigin: r.origin ?? null,
      job: null,
      decidedAt: null,
    });
  }
  return [...byJob.values()].sort(newestFirst);
}

function newestDecidedAt(j: MatchedJob): Date | null {
  const times = j.rows
    .map((r) => (r.decidedAt ? new Date(r.decidedAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Grouped match jobs (Matches, Review, Disqualified) as items; keeps their order. */
export function matchedJobItems(jobs: MatchedJob[]): PostListItem[] {
  return jobs.map((j) => {
    const first = j.rows[0];
    const profileIds: string[] = [];
    mergeProfiles(
      profileIds,
      j.rows.map((r) => r.profileId),
    );
    return {
      jobId: j.jobId,
      kind: first?.kind ?? null,
      title: first?.title ?? null,
      companyName: first?.companyName ?? null,
      postingUrl: first?.postingUrl ?? null,
      postedAt: j.postedAt,
      firstSeenAt: first?.firstSeenAt
        ? new Date(first.firstSeenAt)
        : j.postedAt,
      profileIds,
      decisionStatus: first?.decisionStatus ?? null,
      authorName: first?.posterName ?? null,
      junk: null,
      rescueOrigin: null,
      job: j,
      decidedAt: newestDecidedAt(j),
    };
  });
}
