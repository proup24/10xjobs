import type { Database } from '@xjobs/database/types';
import { effectivePostedAt } from './freshness';
import { CHANNEL_LABELS } from './sources';

export type MatchRow =
  Database['public']['Functions']['match_details']['Returns'][number];

export type MatchedJob = {
  jobId: string;
  /** One per profile that matched. */
  rows: MatchRow[];
  /** Effective posted time. */
  postedAt: Date;
  postedExact: boolean;
  channels: string[];
  viewed: boolean;
  bestStackScore: number | null;
  unverified: boolean;
};

export type Tab = '24h' | '7d';

const DAY_MS = 24 * 3600_000;

/**
 * Only the rows of published profiles. A draft profile is not live, so its leftover rows
 * (from before it went back to draft) never show, in "All profiles" or in any count.
 */
export function publishedRows(
  rows: MatchRow[],
  profiles: { id: string; state: 'draft' | 'published' }[],
): MatchRow[] {
  const published = new Set(
    profiles.filter((p) => p.state === 'published').map((p) => p.id),
  );
  return rows.filter((r) => published.has(r.profileId));
}

/** Rows of jobs the user has not decided on: an applied or dismissed job leaves Matches. */
export function undecidedRows(rows: MatchRow[]): MatchRow[] {
  return rows.filter((r) => r.decisionStatus == null);
}

/**
 * Rows to one job each; newest posted first, then by job id. Closed jobs are dropped
 * unless `keepClosed` (a decided job's detail still shows once it has closed).
 */
export function groupByJob(
  rows: MatchRow[],
  { keepClosed = false }: { keepClosed?: boolean } = {},
): MatchedJob[] {
  const byJob = new Map<string, MatchRow[]>();
  for (const row of rows) {
    if (row.closed && !keepClosed) continue;
    const list = byJob.get(row.jobId);
    if (list) list.push(row);
    else byJob.set(row.jobId, [row]);
  }
  const jobs: MatchedJob[] = [];
  for (const [jobId, list] of byJob) {
    // The job's columns are the same on every row; the first stands for them.
    const first = list[0];
    const { at, exact } = effectivePostedAt(first);
    const scores = list
      .map((r) => r.stackScore)
      .filter((s): s is number => s !== null && s !== undefined);
    jobs.push({
      jobId,
      rows: list,
      postedAt: at,
      postedExact: exact,
      channels: first.channels ?? [],
      viewed: first.viewedAt != null,
      bestStackScore: scores.length ? Math.max(...scores) : null,
      unverified: list.some((r) => r.unverified),
    });
  }
  return jobs.sort(
    (a, b) =>
      b.postedAt.getTime() - a.postedAt.getTime() ||
      (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0),
  );
}

export function selectJobs(
  jobs: MatchedJob[],
  f: { tab: Tab; profileId: string | 'all'; source: string | 'all'; now: Date },
): MatchedJob[] {
  return jobs.filter((j) => {
    if (f.tab === '24h' && f.now.getTime() - j.postedAt.getTime() > DAY_MS)
      return false;
    if (
      f.profileId !== 'all' &&
      !j.rows.some((r) => r.profileId === f.profileId)
    )
      return false;
    if (f.source !== 'all' && !j.channels.includes(f.source)) return false;
    return true;
  });
}

/** The channels present among the jobs, labelled, in label order. */
export function sourceOptions(
  jobs: MatchedJob[],
): { value: string; label: string }[] {
  const present = new Set(jobs.flatMap((j) => j.channels));
  return [...present]
    .map((value) => ({ value, label: CHANNEL_LABELS[value] ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
