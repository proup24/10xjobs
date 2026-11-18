import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { arrangementLine } from '@/lib/matches/facts';
import { isNew, postedAge } from '@/lib/matches/freshness';
import type { MatchedJob } from '@/lib/matches/group';
import { channelBadges } from '@/lib/matches/sources';
import { cn } from '@/lib/utils';

export const stackScoreText = (score: number | null): string =>
  score === null ? 'n/a' : `${Math.round(score * 100)}%`;

/** One job in the list: a link that opens it in the detail. */
export function MatchRowLink({
  job,
  href,
  selected,
  now,
  showProfiles,
  profileLabels,
}: {
  job: MatchedJob;
  href: string;
  selected: boolean;
  now: Date;
  showProfiles: boolean;
  profileLabels: Record<string, string>;
}) {
  const first = job.rows[0];
  const meta = [first.companyName, first.location, arrangementLine(first.facts)]
    .filter(Boolean)
    .join(' · ');
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
        <h3 className="min-w-0 font-medium">{first.title}</h3>
        {job.viewed ? (
          <Badge variant="secondary">Viewed</Badge>
        ) : isNew(job, now) ? (
          <Badge variant="success">New</Badge>
        ) : null}
      </div>
      {meta && <p className="text-muted-foreground">{meta}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {channelBadges(job.channels).map((text) => (
          <Badge key={text} variant="outline">
            {text}
          </Badge>
        ))}
        {showProfiles &&
          job.rows.map((r) => (
            <Badge key={r.profileId} variant="outline">
              {profileLabels[r.profileId] ?? 'Profile'}
            </Badge>
          ))}
        <span>Stack {stackScoreText(job.bestStackScore)}</span>
        <span className="ml-auto">{postedAge(job, now)}</span>
      </div>
    </Link>
  );
}
