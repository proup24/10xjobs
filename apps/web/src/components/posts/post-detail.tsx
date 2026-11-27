import { BackLink, PostLinks } from '@/components/matches/match-detail';
import type { PostDetails } from '@/lib/posts/load';
import { VERDICTS } from './post-row';
import { PostSection, postParts } from './post-section';

/** "Junk · <reason>" or "Not hiring · <reason>"; null for a hiring post or no verdict. */
export function verdictLine(verdict: unknown): string | null {
  if (typeof verdict !== 'object' || verdict === null) return null;
  const { value, reason } = verdict as { value?: unknown; reason?: unknown };
  const label = typeof value === 'string' ? VERDICTS[value] : undefined;
  if (!label) return null;
  return typeof reason === 'string' && reason ? `${label} · ${reason}` : label;
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
}: {
  details: PostDetails;
  now: Date;
  userId: string;
  backHref: string;
  /** The page's own actions on the post (Rescue, Undo rescue). */
  actions?: React.ReactNode;
}) {
  const { author } = postParts(details.sources);
  const verdict = verdictLine(details.verdict);
  return (
    <article className="flex min-w-0 flex-col gap-6">
      <BackLink href={backHref} />
      <header className="flex flex-col gap-1">
        <h2 className="min-w-0 text-title-3 break-words">
          {author?.name ? `Post by ${author.name}` : 'LinkedIn post'}
        </h2>
        {verdict && <p className="text-muted-foreground">{verdict}</p>}
      </header>
      <PostLinks
        postingUrl={details.postingUrl ?? null}
        applyUrl={null}
        userId={userId}
        jobId={details.jobId}
      />
      {actions}
      <PostSection details={details} now={now} />
    </article>
  );
}
