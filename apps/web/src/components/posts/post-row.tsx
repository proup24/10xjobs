import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { stackScoreText } from '@/components/matches/match-row';
import { arrangementLine } from '@/lib/matches/facts';
import { isNew, postedAge, timeAgo } from '@/lib/matches/freshness';
import type { PostExtras, PostListItem } from '@/lib/posts/load';
import { firstFailedReason } from '@/lib/posts/lists';
import type { PostList } from '@/lib/posts/view-state';
import { cn } from '@/lib/utils';

/** The how-to-apply word for the row: the first stated way the row's wording covers. */
const APPLY_WORDS: Record<string, string> = {
  email: 'Email',
  external_link: 'Apply link',
  linkedin_job: 'Job board',
  connect_dm_comment: 'DM the author',
};

export function applyWord(kinds: string[] | null | undefined): string | null {
  for (const k of kinds ?? []) if (APPLY_WORDS[k]) return APPLY_WORDS[k];
  return null;
}

const VERDICTS: Record<string, string> = {
  not_hiring: 'Not hiring',
  junk: 'Junk',
};

/** One post in a social posts tab: `MatchRowLink`'s layout plus the post's badges and reason. */
export function PostRow({
  item,
  list,
  extras,
  href,
  selected,
  now,
  profileId,
  showProfiles,
  profileLabels,
}: {
  item: PostListItem;
  list: PostList;
  extras: PostExtras | undefined;
  href: string;
  selected: boolean;
  now: Date;
  /** The profile picked; its own failed check comes first on Disqualified. */
  profileId: string | 'all';
  showProfiles: boolean;
  profileLabels: Record<string, string>;
}) {
  const job = item.job;
  const first = job?.rows[0];
  const author = item.authorName ?? extras?.authorName ?? null;
  const title = item.title ?? (author ? `Post by ${author}` : 'LinkedIn post');
  const meta = [
    item.companyName,
    first?.location,
    first ? arrangementLine(first.facts) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const how = applyWord(extras?.applyKinds);
  const reason =
    list === 'disqualified' && job
      ? firstFailedReason(job.rows, profileId)
      : null;
  const age = job
    ? postedAge(job, now)
    : timeAgo(list === 'junk' ? item.firstSeenAt : item.postedAt, now);
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border border-transparent p-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        selected && 'border-border bg-accent text-accent-foreground',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-medium">{title}</h3>
        {job?.viewed ? (
          <Badge variant="secondary">Viewed</Badge>
        ) : job && isNew(job, now) ? (
          <Badge variant="success">New</Badge>
        ) : null}
      </div>
      {meta && <p className="text-muted-foreground">{meta}</p>}
      {item.junk && (
        <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Badge variant="outline">
            {VERDICTS[item.junk.verdict] ?? item.junk.verdict}
          </Badge>
          <span>{item.junk.reason}</span>
        </p>
      )}
      {reason && <p className="text-muted-foreground">{reason}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {extras?.emailPending && (
          <Badge variant="secondary">Email pending</Badge>
        )}
        {item.rescueOrigin && <Badge variant="success">Rescued</Badge>}
        {job?.unverified && <Badge variant="warning">Unverified</Badge>}
        {showProfiles &&
          item.profileIds.map((p) => (
            <Badge key={p} variant="outline">
              {profileLabels[p] ?? 'Profile'}
            </Badge>
          ))}
        {how && <span>{how}</span>}
        {job && <span>Stack {stackScoreText(job.bestStackScore)}</span>}
        <span className="ml-auto">{age}</span>
      </div>
    </Link>
  );
}
