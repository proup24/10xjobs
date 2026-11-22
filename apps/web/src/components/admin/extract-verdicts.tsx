import {
  LISTED_VERDICTS,
  POST_VERDICT_REASONS,
  type ListedVerdict,
} from '@xjobs/database/enums';
import type {
  AutoSilenceCandidateView,
  ReviewPage,
  VerdictView,
} from '@xjobs/engine-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Code, TextLink } from '@/components/ui/text';
import { SilenceButton } from './author-actions';
import {
  Author,
  Note,
  OpenPost,
  PREPARE_REVIEW_PATH,
  Section,
  day,
} from './prepare-review';

const VERDICT_LABEL: Record<ListedVerdict, string> = {
  not_hiring: 'Not hiring',
  junk: 'Junk',
};

/** An unknown code (a newer engine) shows as itself. */
const verdictLabel = (verdict: string): string =>
  (VERDICT_LABEL as Record<string, string | undefined>)[verdict] ?? verdict;

const VERDICT_ITEMS = [
  { value: null, label: 'Any verdict' },
  ...LISTED_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] })),
];
const REASON_ITEMS = [
  { value: null, label: 'Any reason' },
  ...POST_VERDICT_REASONS.map((r) => ({ value: r, label: r })),
];

type Props = {
  /** The filters in force, or null. */
  verdict: ListedVerdict | null;
  reason: string | null;
  /** Null when the engine could not give the list. */
  page: ReviewPage<VerdictView> | null;
  /** Keys of the silenced authors. */
  silenced: Set<string>;
  nextHref: string | null;
  /** Who automatic silencing would silence now; null when the engine could not say. */
  candidates: AutoSilenceCandidateView[] | null;
};

function FilterSelect({
  id,
  label,
  name,
  items,
  value,
}: {
  id: string;
  label: string;
  name: string;
  items: { value: string | null; label: string }[];
  value: string | null;
}) {
  return (
    <Field className="w-full max-w-xs">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select name={name} items={items} defaultValue={value}>
        <SelectTrigger id={id} aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value ?? ''} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function VerdictFilter({
  verdict,
  reason,
}: {
  verdict: ListedVerdict | null;
  reason: string | null;
}) {
  return (
    <form
      method="get"
      action={PREPARE_REVIEW_PATH}
      className="flex flex-wrap items-end gap-2"
    >
      <FilterSelect
        id="extract-verdict"
        label="Verdict"
        name="verdict"
        items={VERDICT_ITEMS}
        value={verdict}
      />
      <FilterSelect
        id="extract-reason"
        label="Reason"
        name="reason"
        items={REASON_ITEMS}
        value={reason}
      />
      <Button type="submit" variant="outline">
        Filter
      </Button>
      {(verdict || reason) && (
        <TextLink href={PREPARE_REVIEW_PATH} className="self-center">
          Clear filter
        </TextLink>
      )}
    </form>
  );
}

function Verdicts({
  page,
  silenced,
}: {
  page: ReviewPage<VerdictView>;
  silenced: Set<string>;
}) {
  if (page.items.length === 0)
    return <Note>No posts ruled not hiring or junk.</Note>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Verdict</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Quote</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Posted</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {page.items.map((v) => (
          <TableRow key={v.jobId}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1">
                <Badge
                  variant={v.verdict === 'junk' ? 'destructive' : 'secondary'}
                >
                  {verdictLabel(v.verdict)}
                </Badge>
                {v.confidence === 'unsure' && (
                  <Badge variant="outline">Unsure</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Code>{v.reason}</Code>
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal break-words">
              {v.quote || '—'}
            </TableCell>
            <TableCell className="whitespace-normal">
              <Author author={v.author} />
            </TableCell>
            <TableCell>{day(v.postedAt)}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <OpenPost url={v.url} />
                {v.author.key &&
                  (silenced.has(v.author.key) ? (
                    <Badge variant="secondary">Silenced</Badge>
                  ) : (
                    <SilenceButton
                      authorKey={v.author.key}
                      name={v.author.name}
                    />
                  ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Candidates({
  candidates,
}: {
  candidates: AutoSilenceCandidateView[];
}) {
  if (candidates.length === 0)
    return <Note>No author meets the automatic silencing rule.</Note>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Author</TableHead>
          <TableHead>Posts</TableHead>
          <TableHead>First seen</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>Verdicts</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((c) => (
          <TableRow key={c.authorKey}>
            <TableCell className="whitespace-normal">
              <div className="grid gap-0.5">
                {c.name && <span>{c.name}</span>}
                <Code>{c.authorKey}</Code>
              </div>
            </TableCell>
            <TableCell>{c.counted}</TableCell>
            <TableCell>{day(c.firstSeenAt)}</TableCell>
            <TableCell>{day(c.lastSeenAt)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1">
                {Object.entries(c.verdicts).map(([v, n]) => (
                  <Badge key={v} variant="secondary">
                    {`${verdictLabel(v)} ${n}`}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <SilenceButton authorKey={c.authorKey} name={c.name} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Extracted posts ruled not hiring or junk, newest extraction first, so the owner can
 * confirm the verdicts. Read-only apart from silencing an author; a wrong verdict is
 * fixed in the prompt and the golden set, not here.
 */
export function ExtractVerdicts({
  verdict,
  reason,
  page,
  silenced,
  nextHref,
  candidates,
}: Props) {
  return (
    <>
      <Section
        id="extract-verdicts"
        title="Extract verdicts"
        description="Posts the processor ruled not hiring or junk, newest first. Silencing an author silences the original author, so it holds their future posts, not a post made only of shares."
      >
        <VerdictFilter verdict={verdict} reason={reason} />
        {page ? (
          <Verdicts page={page} silenced={silenced} />
        ) : (
          <Note>Couldn&apos;t load extract verdicts.</Note>
        )}
        {nextHref && (
          <TextLink href={nextHref} className="w-fit">
            Next verdicts
          </TextLink>
        )}
      </Section>
      <Section
        id="auto-silence-candidates"
        title="Automatic silencing candidates"
        description="Authors with at least 10 counted posts over 7 days or more, every counted one ruled not hiring or junk with a sure verdict (unsure and role-filled posts not counted), and none qualified. After you remove an automatic silence, only posts first seen later count. Automatic silencing silences them daily at 04:00 UTC once POST_AUTO_SILENCE is on; until then it only logs them."
      >
        {candidates ? (
          <Candidates candidates={candidates} />
        ) : (
          <Note>Couldn&apos;t load automatic silencing candidates.</Note>
        )}
      </Section>
    </>
  );
}
