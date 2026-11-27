import type { MatchedJob, MatchRow, Tab } from '@/lib/matches/group';
import {
  groupJunk,
  matchedJobItems,
  rescueItems,
  type JunkRow,
  type PostListItem,
  type RescueRow,
} from './load';
import type { PostList } from './view-state';

const DAY_MS = 24 * 3600_000;

export type PostLists = Record<PostList, PostListItem[]>;

function newestPosted(a: PostListItem, b: PostListItem): number {
  return (
    b.postedAt.getTime() - a.postedAt.getTime() ||
    (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0)
  );
}

const undecided = (j: MatchedJob) =>
  j.rows.every((r) => r.decisionStatus == null);

/**
 * The four tabs' items from the page's reads (published post-search profiles' rows, grouped).
 * - Matches: undecided qualified jobs, plus rescues with no decision; a job in both shows once,
 *   as Rescued (with its match rows, for the row layout).
 * - Review: undecided review jobs with no review choice.
 * - Disqualified: rejected jobs, newest decision first.
 * - Junk: the junk rows.
 * A rescued job shows only in Matches (or nowhere once decided): it leaves every other tab.
 * Blocked authors' rescues are already left out by `post_rescue_list`.
 */
export function buildPostLists(input: {
  qualified: MatchedJob[];
  review: MatchedJob[];
  rejected: MatchedJob[];
  junk: JunkRow[];
  rescues: RescueRow[];
}): PostLists {
  const rescues = rescueItems(input.rescues);
  const rescued = new Set(rescues.map((r) => r.jobId));
  const notRescued = (i: PostListItem) => !rescued.has(i.jobId);

  const byJob = new Map<string, MatchedJob>();
  for (const j of [...input.rejected, ...input.review, ...input.qualified])
    byJob.set(j.jobId, j);

  const qualified = matchedJobItems(input.qualified.filter(undecided));
  const liveRescues = rescues
    .filter((r) => r.decisionStatus == null)
    .map((r) => {
      const job = byJob.get(r.jobId);
      if (!job) return r;
      const [m] = matchedJobItems([job]);
      const profileIds = [...m.profileIds];
      for (const p of r.profileIds)
        if (!profileIds.includes(p)) profileIds.push(p);
      return { ...m, profileIds, rescueOrigin: r.rescueOrigin };
    });

  return {
    matches: [...qualified.filter(notRescued), ...liveRescues].sort(
      newestPosted,
    ),
    review: matchedJobItems(
      input.review.filter(
        (j) => undecided(j) && j.rows.every((r) => r.reviewChoice == null),
      ),
    ).filter(notRescued),
    disqualified: matchedJobItems(input.rejected)
      .filter(notRescued)
      .sort(
        (a, b) =>
          (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0) ||
          newestPosted(a, b),
      ),
    junk: groupJunk(input.junk).filter(notRescued),
  };
}

/**
 * One tab's items for a profile ('all' keeps every item) and window: Junk by when the post was
 * first seen, the others by when it was posted.
 */
export function selectPostItems(
  items: PostListItem[],
  f: { list: PostList; tab: Tab; profileId: string | 'all'; now: Date },
): PostListItem[] {
  return items.filter((i) => {
    const at = f.list === 'junk' ? i.firstSeenAt : i.postedAt;
    if (f.tab === '24h' && f.now.getTime() - at.getTime() > DAY_MS)
      return false;
    if (f.profileId !== 'all' && !i.profileIds.includes(f.profileId))
      return false;
    return true;
  });
}

/** The first failed check's reason among the rows (a profile's own rows first); null for none. */
export function firstFailedReason(
  rows: MatchRow[],
  profileId: string | 'all',
): string | null {
  const own = rows.filter((r) => r.profileId === profileId);
  for (const r of own.length ? own : rows) {
    if (!Array.isArray(r.checks)) continue;
    for (const c of r.checks) {
      if (
        c &&
        typeof c === 'object' &&
        !Array.isArray(c) &&
        c.outcome === 'fail' &&
        typeof c.reason === 'string'
      )
        return c.reason;
    }
  }
  return null;
}
