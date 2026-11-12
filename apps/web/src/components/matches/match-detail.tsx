'use client';

import { Check, CircleHelp, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text';
import { checkLines, notCheckedText, type Labels } from '@/lib/matches/checks';
import {
  conflictLines,
  factLines,
  stackLines,
  type ConflictField,
  type FactLine,
} from '@/lib/matches/facts';
import { postedPhrase } from '@/lib/matches/freshness';
import { groupByJob, type MatchRow } from '@/lib/matches/group';
import { markViewed } from '@/lib/matches/mark-viewed';
import { channelLabel } from '@/lib/matches/sources';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { stackScoreText } from './match-row';

const NOT_STATED = 'Not stated';

/**
 * The links that leave for the job's own pages, in a new tab. Either one marks the job
 * viewed; the tab opens at once and the list refreshes once the write is done.
 */
function PostLinks({
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
export function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
    >
      <ChevronLeft aria-hidden />
      Back to matches
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
}: {
  /** The job's rows, one per matching profile; non-empty. */
  rows: MatchRow[];
  labels: Labels;
  profileLabels: Record<string, string>;
  now: Date;
  userId: string;
  backHref: string;
}) {
  const [profileId, setProfileId] = useState(rows[0]?.profileId);
  const [job] = groupByJob(rows);
  if (!job) return null;
  const first = job.rows[0];
  const shown = job.rows.find((r) => r.profileId === profileId) ?? first;
  const facts = factLines(first);
  const conflicts = conflictLines(first.conflicts);
  const techLabels = new Map(labels.techs.map((t) => [t.value, t.label]));
  const stack = stackLines(shown.checks, (c) => techLabels.get(c) ?? c);
  const lines = checkLines(shown.checks, labels);
  const sources = job.channels.map(channelLabel).join(' and ');
  const profileLabel = (id: string) => profileLabels[id] ?? 'Profile';

  const factRows: [string, FactLine | null, ConflictField | null][] = [
    ['Role', facts.role, null],
    ['Seniority', facts.seniority, 'seniority'],
    ['Arrangement', facts.arrangement, 'arrangement'],
    ['Places', facts.places, 'places'],
    ['Contract type', facts.contractType, 'contractType'],
    ['Engagement', facts.engagement, null],
    ['Salary', facts.salary, 'salary'],
  ];
  const noStack =
    stack.covered.length + stack.uncovered.length + stack.notCompared.length ===
    0;

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <BackLink href={backHref} />

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

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {factRows.map(([term, value, field]) => (
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

      <Section title={`Why it matched · ${profileLabel(shown.profileId)}`}>
        <ul className="flex flex-col gap-1.5">
          {lines.map((l) => (
            <li key={l.rule} className="flex items-start gap-2">
              {l.mark === 'pass' ? (
                <Check
                  aria-label="Pass"
                  className="mt-0.5 shrink-0 text-success"
                />
              ) : (
                <CircleHelp
                  aria-label="Unknown"
                  className="mt-0.5 shrink-0 text-warning"
                />
              )}
              <span>
                <span className="font-medium">{l.label}</span>
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
