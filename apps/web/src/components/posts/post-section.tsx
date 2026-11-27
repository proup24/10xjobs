import { BlockAuthorButton } from './block-author-button';
import { Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/text';
import { timeAgo } from '@/lib/matches/freshness';
import type { PostDetails } from '@/lib/posts/load';

type Person = {
  name: string | null;
  profileUrl: string | null;
  authorKey: string | null;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => str(x) !== null) : [];

function person(v: unknown): Person | null {
  if (!isObject(v)) return null;
  const p = {
    name: str(v.name),
    profileUrl: str(v.profileUrl),
    authorKey: str(v.key),
  };
  return p.name || p.profileUrl ? p : null;
}

/**
 * The post's people and texts from its `postSources.sources` entries: each entry is a plain
 * post or a share of `original`. The author and text are the original's; every share adds its
 * sharer and the sharer's own words.
 */
export function postParts(sources: unknown): {
  author: Person | null;
  text: string | null;
  sharers: { author: Person | null; text: string | null }[];
} {
  let author: Person | null = null;
  let text: string | null = null;
  const sharers: { author: Person | null; text: string | null }[] = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!isObject(s)) continue;
    const original = isObject(s.original) ? s.original : null;
    if (original) {
      sharers.push({ author: person(s.author), text: str(s.text) });
      author ??= person(original.author);
      text ??= str(original.text);
    } else {
      author ??= person(s.author);
      text ??= str(s.text);
    }
  }
  return { author, text, sharers };
}

type Linked = { jobId: string; kind: string; authorName: string | null };

function linkedCopies(v: unknown): Linked[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((l) => {
    if (!isObject(l)) return [];
    const jobId = str(l.jobId);
    const kind = str(l.kind);
    return jobId && kind
      ? [{ jobId, kind, authorName: str(l.authorName) }]
      : [];
  });
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

function PersonLink({ p }: { p: Person | null }) {
  const name = p?.name ?? 'LinkedIn member';
  const who = p?.profileUrl ? (
    <TextLink href={p.profileUrl} target="_blank" rel="noopener noreferrer">
      {name}
    </TextLink>
  ) : (
    <span>{name}</span>
  );
  // The matcher skips authors without a key, so there is nothing to block.
  if (!p?.authorKey) return who;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {who}
      <BlockAuthorButton
        authorKey={p.authorKey}
        name={name}
        profileUrl={p.profileUrl}
      />
    </span>
  );
}

/** One way to apply per line: the email (Email pending until it is settled), links, a DM. */
function HowToApply({
  how,
  emailPending,
}: {
  how: Record<string, unknown>;
  emailPending: boolean;
}) {
  const kinds = strings(how.kinds);
  const email = kinds.includes('email') ? str(how.email) : null;
  const links = strings(how.links);
  const dm = kinds.includes('connect_dm_comment');
  return (
    <Section title="How to apply">
      {email || links.length > 0 || dm ? (
        <ul className="flex flex-col gap-1.5">
          {email && (
            <li className="flex flex-wrap items-center gap-2">
              <span className="break-all">{email}</span>
              {emailPending && <Badge variant="secondary">Email pending</Badge>}
            </li>
          )}
          {links.map((l) => (
            <li key={l} className="min-w-0 break-all">
              <TextLink href={l} target="_blank" rel="noopener noreferrer">
                {l}
              </TextLink>
            </li>
          ))}
          {dm && <li>DM, comment or connect with the author</li>}
        </ul>
      ) : (
        <p className="text-muted-foreground">Not stated</p>
      )}
    </Section>
  );
}

/**
 * A post's own part of its detail: when it was posted, how to apply, who posted (and shared)
 * it, its text and its linked copies. The texts are rendered as text, never as HTML.
 */
export function PostSection({
  details,
  now,
}: {
  details: PostDetails;
  now: Date;
}) {
  const { author, text, sharers } = postParts(details.sources);
  const how = isObject(details.howToApply) ? details.howToApply : null;
  const linked = linkedCopies(details.linked);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {details.postedAt && (
        <p className="text-muted-foreground">
          {`Posted ${timeAgo(new Date(details.postedAt), now)}`}
        </p>
      )}

      {how && (
        <HowToApply how={how} emailPending={Boolean(details.emailPending)} />
      )}

      <Section title="The author">
        <dl className="flex flex-col gap-2">
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Posted by</dt>
            <dd>
              <PersonLink p={author} />
            </dd>
          </div>
          {sharers.length > 0 && (
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Shared by</dt>
              {sharers.map((s, i) => (
                <dd key={s.author?.profileUrl ?? i}>
                  <PersonLink p={s.author} />
                </dd>
              ))}
            </div>
          )}
        </dl>
      </Section>

      <Section title="The post">
        {sharers
          .filter((s) => s.text)
          .map((s, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className="text-muted-foreground">
                {`${s.author?.name ?? 'The sharer'} wrote`}
              </p>
              <p className="break-words whitespace-pre-line">{s.text}</p>
            </div>
          ))}
        <p
          className={
            text
              ? 'border-l-2 border-border pl-3 break-words whitespace-pre-line'
              : 'text-muted-foreground'
          }
        >
          {text ?? 'Not stated'}
        </p>
      </Section>

      {linked.length > 0 && (
        <Section title="Linked copies">
          <ul className="flex flex-col gap-1.5">
            {linked.map((l) => (
              <li key={l.jobId}>
                {l.kind === 'post_role' ? (
                  <TextLink href={`/posts?job=${l.jobId}`}>
                    {`Also posted by ${l.authorName ?? 'another author'}`}
                  </TextLink>
                ) : (
                  <TextLink href={`/?job=${l.jobId}`}>
                    Also on the job board
                  </TextLink>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
