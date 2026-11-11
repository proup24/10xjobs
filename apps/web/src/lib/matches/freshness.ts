import type { MatchedJob, MatchRow } from './group';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A job stays "New" this long after its exact posted time. */
const NEW_WINDOW_MS = 12 * HOUR;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * When the job was posted: `postedAt` when known (exact), else the published date at
 * 00:00 UTC, else when we first saw it. The last two are estimates, never "New".
 */
export function effectivePostedAt(
  // The generated row type says non-null, but the columns are nullable in Postgres.
  row: Pick<MatchRow, 'firstSeenAt'> & {
    postedAt: string | null;
    publishedAt: string | null;
  },
): { at: Date; exact: boolean } {
  if (row.postedAt) return { at: new Date(row.postedAt), exact: true };
  if (row.publishedAt) {
    const day = row.publishedAt.slice(0, 10);
    return { at: new Date(`${day}T00:00:00Z`), exact: false };
  }
  return { at: new Date(row.firstSeenAt), exact: false };
}

export function isNew(job: MatchedJob, now: Date): boolean {
  return (
    job.postedExact &&
    !job.viewed &&
    now.getTime() - job.postedAt.getTime() <= NEW_WINDOW_MS
  );
}

/** "12 min ago", "3 h ago", "2 days ago"; a date-only post reads "Nov 9". */
export function postedAge(job: MatchedJob, now: Date): string {
  const at = job.postedAt;
  if (!job.postedExact) {
    return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
  }
  const ms = Math.max(0, now.getTime() - at.getTime());
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MIN))} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  const days = Math.floor(ms / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
