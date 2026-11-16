import Link from 'next/link';
import {
  DISMISS_REASON_LABELS,
  DISMISS_REASONS,
  type DismissReason,
} from '@xjobs/database/enums';
import { Badge } from '@/components/ui/badge';
import type { DecisionRow } from '@/lib/applications/load';
import { timeAgo } from '@/lib/matches/freshness';
import { channelLabel } from '@/lib/matches/sources';
import { cn } from '@/lib/utils';

/** The row's reason as a known code; null for none (the column is nullable). */
export function dismissReason(row: DecisionRow): DismissReason | null {
  const reason = row.reason as string | null;
  return DISMISS_REASONS.find((r) => r === reason) ?? null;
}

/** "Applied 2 days ago", or "Not for me · Wrong seniority · 3 days ago". */
export function decisionLine(row: DecisionRow, now: Date): string {
  const ago = timeAgo(new Date(row.decidedAt), now);
  if (row.status === 'applied') return `Applied ${ago}`;
  const reason = dismissReason(row);
  return ['Not for me', reason && DISMISS_REASON_LABELS[reason], ago]
    .filter(Boolean)
    .join(' · ');
}

/** One decided job in the list: a link that opens it in the detail. */
export function DecisionRowLink({
  row,
  href,
  selected,
  now,
}: {
  row: DecisionRow;
  href: string;
  selected: boolean;
  now: Date;
}) {
  const meta = [row.companyName, row.location].filter(Boolean).join(' · ');
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
        <h3 className="min-w-0 font-medium">{row.title}</h3>
        {row.closed && <Badge variant="secondary">Closed</Badge>}
      </div>
      {meta && <p className="text-muted-foreground">{meta}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {(row.channels ?? []).map((c) => (
          <Badge key={c} variant="outline">
            {channelLabel(c)}
          </Badge>
        ))}
        <span className="ml-auto">{decisionLine(row, now)}</span>
      </div>
    </Link>
  );
}
