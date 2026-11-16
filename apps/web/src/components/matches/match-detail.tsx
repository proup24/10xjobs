'use client';

import { Check, ChevronLeft, CircleHelp, CircleX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DismissReason } from '@xjobs/database/enums';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text';
import {
  checkLines,
  fieldLabel,
  notCheckedText,
  ruleLabel,
  type Labels,
} from '@/lib/matches/checks';
import {
  conflictLines,
  factLines,
  factQuotes,
  stackLines,
  type ConflictField,
  type FactLine,
} from '@/lib/matches/facts';
import { postedPhrase } from '@/lib/matches/freshness';
import { groupByJob, type MatchRow } from '@/lib/matches/group';
import { markViewed } from '@/lib/matches/mark-viewed';
import type { ReportField } from '@/lib/matches/report';
import { channelLabel } from '@/lib/matches/sources';
import type { SaveResult } from '@/lib/setup/save-result';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DismissDialog } from './dismiss-dialog';
import { stackScoreText } from './match-row';
import { ReportDialog, type Report } from './report-dialog';

const NOT_STATED = 'Not stated';

export type ReviewChoice = 'qualified' | 'rejected';
export type Decide = (d: {
  matchId: string;
  choice: ReviewChoice;
}) => Promise<SaveResult>;

const DECIDED: Record<ReviewChoice, string> = {
  qualified: 'Moved to matches',
  rejected: 'Rejected',
};

/** The conflicts that bear on each fact a review can rest on. */
const FIELD_CONFLICTS: Record<string, ConflictField[]> = {
  seniority: ['seniority'],
  yearsRequired: ['seniority'],
  openings: ['arrangement', 'places'],
  salary: ['salary'],
  contractType: ['contractType'],
};

/**
 * The report field for each fact a review can rest on. Tech stack, languages and work
 * authorization have no line in the facts list: the review is where they can be reported.
 */
const REVIEW_REPORT_FIELDS: Record<string, ReportField> = {
  position: 'role',
  isSoftwareEngineeringRole: 'role',
  seniority: 'seniority',
  yearsRequired: 'yearsRequired',
  openings: 'places',
  salary: 'salary',
  contractType: 'contractType',
  techStack: 'techStack',
  requiredLanguages: 'requiredLanguages',
  workAuthorization: 'workAuthorization',
};

/**
 * Why a job is in review: the rule that would have rejected it, the fact it was unsure
 * of with the description's words for it, and LinkedIn's value when the listing disagreed,
 * with "Report a mismatch" on that fact. Then the two decisions; Reject asks first.
 */
function ReviewReason({
  row,
  onDecide,
  onReport,
}: {
  row: MatchRow;
  onDecide?: Decide;
  onReport?: Report;
}) {
  const [pending, setPending] = useState(false);
  const field = row.reviewField ?? '';
  const reportField = REVIEW_REPORT_FIELDS[field];
  const quotes = factQuotes(row.facts, field);
  const conflicts = conflictLines(row.conflicts);
  const listing = (FIELD_CONFLICTS[field] ?? [])
    .map((f) => conflicts[f])
    .filter((x): x is string => Boolean(x));

  /** Saves and reports the decision; false when it was not saved. */
  const decide = async (choice: ReviewChoice): Promise<boolean> => {
    if (!onDecide) return false;
    let result: SaveResult;
    try {
      result = await onDecide({ matchId: row.matchId, choice });
    } catch {
      result = { status: 'failed' };
    }
    if (result.status === 'saved') {
      toast.success(DECIDED[choice]);
      return true;
    }
    toast.error(
      result.status === 'invalid' && result.errors._form
        ? result.errors._form
        : "Couldn't save your decision. Try again.",
    );
    return false;
  };

  return (
    <Section title="Why it's in review">
      <dl className="flex flex-col gap-2">
        <div className="flex flex-col">
          <dt className="text-muted-foreground">Would be rejected by</dt>
          <dd>{ruleLabel(row.reviewRule) ?? row.reviewRule}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Unsure about</dt>
          <dd>{fieldLabel(field)}</dd>
          {quotes.map((q) => (
            <dd
              key={q}
              className="border-l-2 border-border pl-3 break-words whitespace-pre-line"
            >
              {`“${q}”`}
            </dd>
          ))}
          {quotes.length === 0 && (
            <dd className="text-muted-foreground">
              The description has no words for it to quote.
            </dd>
          )}
          {listing.map((l) => (
            <dd key={l} className="text-muted-foreground">
              {l}
            </dd>
          ))}
          {onReport && reportField && (
            <dd>
              <ReportDialog
                jobId={row.jobId}
                field={reportField}
                label={fieldLabel(field)}
                onReport={onReport}
              />
            </dd>
          )}
        </div>
      </dl>
      {onDecide && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await decide('qualified');
              } finally {
                setPending(false);
              }
            }}
          >
            Move to matches
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={pending}>
                Reject
              </Button>
            }
            title="Reject"
            description="Reject this job? It will leave your review list."
            confirmLabel="Reject"
            destructive
            onConfirm={async () => {
              // Keep the dialog open on a failure; the toast has said why.
              if (!(await decide('rejected'))) throw new Error('not saved');
            }}
            onError={() => undefined}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * The links that leave for the job's own pages, in a new tab. Either one marks the job
 * viewed; the tab opens at once and the list refreshes once the write is done.
 */
export function PostLinks({
  postingUrl,
  applyUrl,
  userId,
  jobId,
}: {
  postingUrl: string | null;
  applyUrl: string | null;
  userId: string;
  jobId: string;
}) {
  const router = useRouter();
  const onClick = () => {
    void markViewed(createSupabaseBrowserClient(), userId, jobId).then(() =>
      router.refresh(),
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      {postingUrl && (
        <a
          href={postingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={buttonVariants()}
        >
          Open post
        </a>
      )}
      {applyUrl && (
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={buttonVariants({ variant: 'outline' })}
        >
          Apply
        </a>
      )}
    </div>
  );
}

export type DecideJob = (
  status: 'applied' | 'dismissed',
  extra?: { reason?: DismissReason; note?: string },
) => Promise<boolean>;

/** "Applied" and "Not for me" on a match; the second asks for an optional reason first. */
function JobDecision({ onDecideJob }: { onDecideJob: DecideJob }) {
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          try {
            await onDecideJob('applied');
          } finally {
            setPending(false);
          }
        }}
      >
        Applied
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => setAsking(true)}
      >
        Not for me
      </Button>
      <DismissDialog
        open={asking}
        onOpenChange={setAsking}
        onConfirm={(extra) => onDecideJob('dismissed', extra)}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-title-5">{title}</h3>
      {children}
    </section>
  );
}

function TechList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground">{title}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/** Below `md`, where the list is hidden while a job is open: the way back to it. */
export function BackLink({
  href,
  label = 'Back to matches',
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
    >
      <ChevronLeft aria-hidden />
      {label}
    </Link>
  );
}

/** The selected job: facts first, then why it matched, then the description. */
export function MatchDetail({
  rows,
  labels,
  profileLabels,
  now,
  userId,
  backHref,
  backLabel,
  actions,
  onDecide,
  onDecideJob,
  onReport,
}: {
  /** The job's rows, one per matching profile; non-empty. */
  rows: MatchRow[];
  labels: Labels;
  profileLabels: Record<string, string>;
  now: Date;
  userId: string;
  backHref: string;
  /** The back link's text; "Back to matches" by default. */
  backLabel?: string;
  /** The page's own actions on the job, under the post links (Applications). */
  actions?: React.ReactNode;
  /** Records a decision on a review row; the buttons show only with it. */
  onDecide?: Decide;
  /** Marks the job applied or not for me; the buttons show only with it, on matches. */
  onDecideJob?: DecideJob;
  /** Logs a mismatch on a fact; the report buttons show only with it. */
  onReport?: Report;
}) {
  const [profileId, setProfileId] = useState(rows[0]?.profileId);
  // The caller chose which rows to show; a closed job it passes still shows.
  const [job] = groupByJob(rows, { keepClosed: true });
  if (!job) return null;
  const first = job.rows[0];
  const shown = job.rows.find((r) => r.profileId === profileId) ?? first;
  const facts = factLines(first);
  const conflicts = conflictLines(first.conflicts);
  const techLabels = new Map(labels.techs.map((t) => [t.value, t.label]));
  const stack = stackLines(shown.checks, (c) => techLabels.get(c) ?? c);
  const lines = checkLines(shown.checks, labels);
  // `outcome` is the engine's; the user's decision is `reviewChoice`. Only an undecided
  // review row is in review: one the user moved to Matches reads as a match.
  const inReview =
    shown.outcome === 'review' &&
    shown.reviewChoice == null &&
    Boolean(shown.reviewRule);
  const accepted =
    shown.outcome === 'review' && shown.reviewChoice === 'qualified';
  const sources = job.channels.map(channelLabel).join(' and ');
  const profileLabel = (id: string) => profileLabels[id] ?? 'Profile';

  const factRows: [
    string,
    FactLine | null,
    ConflictField | null,
    ReportField,
  ][] = [
    ['Role', facts.role, null, 'role'],
    ['Seniority', facts.seniority, 'seniority', 'seniority'],
    ['Arrangement', facts.arrangement, 'arrangement', 'arrangement'],
    ['Places', facts.places, 'places', 'places'],
    ['Contract type', facts.contractType, 'contractType', 'contractType'],
    ['Engagement', facts.engagement, null, 'engagement'],
    ['Salary', facts.salary, 'salary', 'salary'],
  ];
  const noStack =
    stack.covered.length + stack.uncovered.length + stack.notCompared.length ===
    0;

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <BackLink href={backHref} label={backLabel} />

      <header className="flex flex-col gap-1">
        <h2 className="text-title-3">{first.title}</h2>
        <p>
          {first.companyUrl ? (
            <TextLink
              href={first.companyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {first.companyName}
            </TextLink>
          ) : (
            first.companyName
          )}
          {first.location && (
            <span className="text-muted-foreground"> · {first.location}</span>
          )}
        </p>
        <p className="text-muted-foreground">
          {`posted ${postedPhrase(job, now)}${sources ? ` on ${sources}` : ''}`}
        </p>
      </header>

      <PostLinks
        postingUrl={first.postingUrl}
        applyUrl={first.applyUrl}
        userId={userId}
        jobId={first.jobId}
      />

      {onDecideJob && !inReview && <JobDecision onDecideJob={onDecideJob} />}

      {actions}

      {inReview && (
        <ReviewReason
          key={shown.matchId}
          row={shown}
          onDecide={onDecide}
          onReport={onReport}
        />
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {factRows.map(([term, value, field, reportField]) => (
          <div key={term} className="flex flex-col items-start">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className={value ? undefined : 'text-muted-foreground'}>
              {value?.text ?? NOT_STATED}
            </dd>
            {value?.source === 'linkedin' && (
              <Badge variant="secondary">From LinkedIn</Badge>
            )}
            {field && conflicts[field] && (
              <p className="text-muted-foreground">{conflicts[field]}</p>
            )}
            {onReport && (
              <ReportDialog
                jobId={first.jobId}
                field={reportField}
                label={term}
                onReport={onReport}
              />
            )}
          </div>
        ))}
      </dl>

      <Separator />

      {job.rows.length > 1 && (
        <Tabs
          value={shown.profileId}
          onValueChange={(v) => setProfileId(String(v))}
        >
          <TabsList aria-label="Matched profiles">
            {job.rows.map((r) => (
              <TabsTrigger key={r.profileId} value={r.profileId}>
                {profileLabel(r.profileId)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Section title="Tech stack">
        <p>Coverage {stackScoreText(shown.stackScore ?? null)}</p>
        {noStack ? (
          <p className="text-muted-foreground">
            Nothing in the job to compare with your stack.
          </p>
        ) : (
          <>
            <TechList title="You have" items={stack.covered} />
            <TechList title="You don't" items={stack.uncovered} />
            <TechList
              title="Mentioned, not compared"
              items={stack.notCompared}
            />
          </>
        )}
      </Section>

      <Section
        title={`${inReview ? 'Checks' : 'Why it matched'} · ${profileLabel(shown.profileId)}`}
      >
        {accepted && (
          <p className="text-muted-foreground">You moved this from review.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {lines.map((l) => (
            <li key={l.rule} className="flex items-start gap-2">
              {l.mark === 'pass' ? (
                <Check
                  aria-label="Pass"
                  className="mt-0.5 shrink-0 text-success"
                />
              ) : l.mark === 'fail' && accepted ? (
                // The check that sent it to review, which the user overruled.
                <CircleX
                  aria-label="Sent to review"
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
              ) : l.mark === 'fail' ? (
                <CircleX
                  aria-label="Fail"
                  className="mt-0.5 shrink-0 text-destructive"
                />
              ) : (
                <CircleHelp
                  aria-label="Unknown"
                  className="mt-0.5 shrink-0 text-warning"
                />
              )}
              <span>
                <span className="font-medium">{l.label}</span>
                {l.unsure && (
                  <span className="text-muted-foreground"> (unsure)</span>
                )}
                <span className="text-muted-foreground"> · </span>
                <span>{l.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{notCheckedText()}</p>
      </Section>

      <Separator />

      <Section title="Description">
        <p className="whitespace-pre-line">
          {first.descriptionText || NOT_STATED}
        </p>
      </Section>
    </article>
  );
}
