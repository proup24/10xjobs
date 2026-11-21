import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

export type EmptyKind =
  | { kind: 'no-profile' }
  | { kind: 'draft'; finishHref: string }
  | { kind: 'no-matches-24h'; weekHref: string }
  | { kind: 'no-matches-7d' }
  | { kind: 'no-review-24h'; weekHref: string }
  | { kind: 'no-review-7d' }
  | { kind: 'filtered'; clearHref: string }
  | { kind: 'not-found' }
  | { kind: 'pick' };

function Action({ href, children }: { href: string; children: string }) {
  return (
    <EmptyContent>
      <Link href={href} className={buttonVariants({ variant: 'outline' })}>
        {children}
      </Link>
    </EmptyContent>
  );
}

/** Every "nothing to show" state of the matches page. */
export function MatchEmpty(props: EmptyKind) {
  const [title, description] = TEXT[props.kind];
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {props.kind === 'no-profile' && (
        <Action href="/setup">Set up your profile</Action>
      )}
      {(props.kind === 'no-matches-24h' || props.kind === 'no-review-24h') && (
        <Action href={props.weekHref}>Last 7 days</Action>
      )}
      {props.kind === 'draft' && (
        <Action href={props.finishHref}>Finish setup</Action>
      )}
      {props.kind === 'filtered' && (
        <Action href={props.clearHref}>Clear filters</Action>
      )}
    </Empty>
  );
}

const TEXT: Record<EmptyKind['kind'], [string, string | null]> = {
  'no-profile': [
    'No profile yet',
    'Tell us what you are looking for and matching starts.',
  ],
  draft: [
    "This profile isn't live yet",
    'Finish setting it up to start matching.',
  ],
  'no-matches-24h': [
    'No matches in the last 24 hours',
    'Matches appear here as new jobs are collected.',
  ],
  'no-matches-7d': [
    'No matches yet',
    "New jobs are matched as they're collected.",
  ],
  'no-review-24h': [
    'Nothing to review from the last 24 hours',
    "Jobs show here when a check failed on a fact the job wasn't clear about.",
  ],
  'no-review-7d': [
    'Nothing to review',
    "Jobs show here when a check failed on a fact the job wasn't clear about.",
  ],
  filtered: ['No matches for this filter', null],
  'not-found': [
    "This job isn't in your matches",
    'It may have closed, or no profile matches it any more.',
  ],
  pick: ['Choose a job', 'Its facts and why it matched show here.'],
};
