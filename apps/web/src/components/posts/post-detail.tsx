import {
  BackLink,
  JobDecision,
  PostLinks,
  type DecideJob,
} from '@/components/matches/match-detail';
import type { PostDetails } from '@/lib/posts/load';
import { NotSure, VERDICTS, reasonText } from './post-row';
import { PostSection, postParts } from './post-section';

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** "Junk · <reason>" or "Not hiring · <reason>"; null for a hiring post or no verdict. */
export function verdictLine(verdict: unknown): string | null {
  const v = asObject(verdict);
  if (!v) return null;
  const label = typeof v.value === 'string' ? VERDICTS[v.value] : undefined;
  if (!label) return null;
  return typeof v.reason === 'string' && v.reason
    ? `${label} · ${reasonText(v.reason)}`
    : label;
}

/**
 * The verdict to show: for a rescued Junk post, the one it was rescued from (the rescue's
 * snapshot), whatever a later extraction says; else the post's current one.
 */
export function shownVerdict(details: PostDetails): unknown {
  const rescued = asObject(asObject(details.rescue)?.verdict);
  return rescued ?? details.verdict;
}

/**
 * A post with no match row to show (a Junk post, or a junk post the user rescued): the verdict
 * the engine dropped it with, its links and the post itself. It has no facts or checks.
 */
export function PostDetail({
  details,
  now,
  userId,
  backHref,
  actions,
  onDecideJob,
}: {
  details: PostDetails;
  now: Date;
  userId: string;
  backHref: string;
  /** The page's own actions on the post (Rescue, Undo rescue). */
  actions?: React.ReactNode;
  /** Marks a rescued post applied, not for me or expired; the buttons show only with it. */
  onDecideJob?: DecideJob;
}) {
  const { author } = postParts(details.sources);
  const shown = shownVerdict(details);
  const verdict = verdictLine(shown);
  return (
    <article className="flex min-w-0 flex-col gap-6">
      <BackLink href={backHref} />
      <header className="flex flex-col gap-1">
        <h2 className="min-w-0 text-title-3 break-words">
          {author?.name ? `Post by ${author.name}` : 'LinkedIn post'}
        </h2>
        {verdict && (
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <span>{verdict}</span>
            <NotSure confidence={asObject(shown)?.confidence} />
          </p>
        )}
      </header>
      <PostLinks
        postingUrl={details.postingUrl ?? null}
        applyUrl={null}
        userId={userId}
        jobId={details.jobId}
      />
      {onDecideJob && <JobDecision onDecideJob={onDecideJob} />}
      {actions}
      <PostSection details={details} now={now} />
    </article>
  );
}
