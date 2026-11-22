import type {
  AuthorView,
  DropView,
  HeldPostView,
  ReviewPage,
  SilencedAuthorView,
} from '@xjobs/engine-client';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Code, TextLink } from '@/components/ui/text';
import { SilenceButton, UnsilenceButton } from './author-actions';

export const PREPARE_REVIEW_PATH = '/admin/prepare';

type Props = {
  /** The rule filter in force, or null. */
  rule: string | null;
  /** Null when the engine could not give the list. */
  drops: ReviewPage<DropView> | null;
  held: ReviewPage<HeldPostView> | null;
  authors: SilencedAuthorView[] | null;
  nextDropsHref: string | null;
  nextHeldHref: string | null;
  /** The Extract verdicts section, shown after the drops. */
  verdicts?: React.ReactNode;
};

export const day = (iso: string | null) =>
  iso ? <time dateTime={iso}>{iso.slice(0, 10)}</time> : '—';

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={id} className="font-heading text-title-5">
          {title}
        </h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function Author({ author }: { author: AuthorView }) {
  return (
    <div className="grid gap-0.5">
      <span>{author.name ?? author.key ?? 'Unknown author'}</span>
      {author.headline && (
        <span className="text-muted-foreground">{author.headline}</span>
      )}
    </div>
  );
}

/** Only an http(s) URL becomes a link; anything else (`data:`, `javascript:`) none. */
function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function OpenPost({ url }: { url: string | null }) {
  if (!url || !isHttpUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonVariants({ variant: 'link', size: 'xs' })}
    >
      Open post
    </a>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function RuleFilter({ rule }: { rule: string | null }) {
  return (
    <form
      method="get"
      action={PREPARE_REVIEW_PATH}
      className="flex flex-wrap items-end gap-2"
    >
      <Field className="w-full max-w-xs">
        <FieldLabel htmlFor="prepare-rule">Rule</FieldLabel>
        <Input
          id="prepare-rule"
          name="rule"
          defaultValue={rule ?? ''}
          placeholder="no-text"
        />
      </Field>
      <Button type="submit" variant="outline">
        Filter
      </Button>
      {rule && (
        <TextLink href={PREPARE_REVIEW_PATH} className="self-center">
          Clear filter
        </TextLink>
      )}
    </form>
  );
}

function Drops({
  page,
  silenced,
}: {
  page: ReviewPage<DropView>;
  silenced: Set<string>;
}) {
  if (page.items.length === 0) return <Note>No dropped posts.</Note>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rule</TableHead>
          <TableHead>Matched text</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Posted</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {page.items.map((d) => (
          <TableRow key={d.rawItemId}>
            <TableCell>{d.rule ? <Code>{d.rule}</Code> : d.reason}</TableCell>
            <TableCell className="max-w-xs whitespace-normal break-words">
              {d.match ?? '—'}
            </TableCell>
            <TableCell className="whitespace-normal">
              <Author author={d.author} />
            </TableCell>
            <TableCell>{day(d.postedAt)}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <OpenPost url={d.url} />
                {d.author.key &&
                  (silenced.has(d.author.key) ? (
                    <Badge variant="secondary">Silenced</Badge>
                  ) : (
                    <SilenceButton
                      authorKey={d.author.key}
                      name={d.author.name}
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

function Held({ page }: { page: ReviewPage<HeldPostView> }) {
  if (page.items.length === 0) return <Note>No held posts.</Note>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Author</TableHead>
          <TableHead>Posted</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {page.items.map((h) => (
          <TableRow key={h.jobId}>
            <TableCell className="whitespace-normal">
              <Author author={h.author} />
            </TableCell>
            <TableCell>{day(h.postedAt)}</TableCell>
            <TableCell>
              <OpenPost url={h.url} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Authors({ authors }: { authors: SilencedAuthorView[] }) {
  if (authors.length === 0) return <Note>No silenced authors.</Note>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Author</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Origin</TableHead>
          <TableHead>Evidence</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {authors.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="whitespace-normal">
              <div className="grid gap-0.5">
                <span>{a.name ?? a.authorKey}</span>
                <Code className="w-fit">{a.authorKey}</Code>
              </div>
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal break-words">
              {a.reason}
            </TableCell>
            <TableCell>
              <Badge variant={a.origin === 'automatic' ? 'warning' : 'outline'}>
                {a.origin}
              </Badge>
            </TableCell>
            <TableCell className="max-w-xs whitespace-normal break-all">
              {a.origin === 'automatic' &&
              a.evidence !== null &&
              a.evidence !== undefined ? (
                <Code>{JSON.stringify(a.evidence)}</Code>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>{day(a.createdAt)}</TableCell>
            <TableCell>
              <UnsilenceButton authorKey={a.authorKey} name={a.name} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The owner's review of what Prepare dropped, the posts held because their authors are
 * silenced, and the silenced authors themselves.
 */
export function PrepareReview({
  rule,
  drops,
  held,
  authors,
  nextDropsHref,
  nextHeldHref,
  verdicts,
}: Props) {
  const silenced = new Set((authors ?? []).map((a) => a.authorKey));
  return (
    <div className="grid max-w-6xl gap-8">
      <h1 className="font-heading text-title-3">Prepare review</h1>

      <Section
        id="prepare-drops"
        title="Dropped posts"
        description="Posts Prepare dropped before processing, newest first."
      >
        <RuleFilter rule={rule} />
        {drops ? (
          <Drops page={drops} silenced={silenced} />
        ) : (
          <Note>Couldn&apos;t load dropped posts.</Note>
        )}
        {nextDropsHref && (
          <TextLink href={nextDropsHref} className="w-fit">
            Next drops
          </TextLink>
        )}
      </Section>

      {verdicts}

      <Section
        id="prepare-held"
        title="Held posts"
        description="Post jobs held because every author who shared them is silenced."
      >
        {held ? (
          <Held page={held} />
        ) : (
          <Note>Couldn&apos;t load held posts.</Note>
        )}
        {nextHeldHref && (
          <TextLink href={nextHeldHref} className="w-fit">
            Next held posts
          </TextLink>
        )}
      </Section>

      <Section
        id="prepare-authors"
        title="Silenced authors"
        description="Authors whose posts are held. Automatic entries show why they were added."
      >
        {authors ? (
          <Authors authors={authors} />
        ) : (
          <Note>Couldn&apos;t load silenced authors.</Note>
        )}
      </Section>
    </div>
  );
}
