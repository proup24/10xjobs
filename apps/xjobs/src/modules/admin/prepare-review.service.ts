import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import { authorOf } from 'src/modules/ingest/normalize/mappers/linkedin-post.mapper';
import { httpUrl } from 'src/modules/ingest/normalize/linkedin';
import { readPostPayload } from 'src/modules/ingest/normalize/posts/payload';
import {
  PrepareReviewRepository,
  type DropRow,
  type HeldPostRow,
} from './prepare-review.repository';
import type {
  AuthorView,
  DropView,
  HeldPostView,
  Page,
  SilencedAuthorView,
} from './prepare-review.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<iso>|<raw item id>` as base64url; the order is lastSeenAt, id (both descending). */
export function encodeDropCursor(row: { lastSeenAt: Date; id: string }) {
  return Buffer.from(`${row.lastSeenAt.toISOString()}|${row.id}`).toString(
    'base64url',
  );
}

export function decodeDropCursor(
  cursor: string,
): { lastSeenAt: string; id: string } | null {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  if (rest.length > 0 || !at || !id) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== at) return null;
  if (!UUID_RE.test(id)) return null;
  return { lastSeenAt: at, id };
}

/**
 * Splits `prepare: <rule>: "<match>"` (rule up to the next `: `, match between
 * the first `: "` and the final `"`) or `prepare: <rule>`. Any other reason has
 * neither.
 */
export function parseDropReason(reason: string): {
  rule: string | null;
  match: string | null;
} {
  const prefix = 'prepare: ';
  if (!reason.startsWith(prefix)) return { rule: null, match: null };
  const rest = reason.slice(prefix.length);
  const sep = rest.indexOf(': ');
  if (sep < 0) return { rule: rest || null, match: null };
  const rule = rest.slice(0, sep);
  const tail = rest.slice(sep + 2);
  const match =
    tail.startsWith('"') && tail.endsWith('"') && tail.length >= 2
      ? tail.slice(1, -1)
      : null;
  return { rule: rule || null, match };
}

function authorView(author: {
  key?: unknown;
  name?: unknown;
  headline?: unknown;
  profileUrl?: unknown;
}): AuthorView {
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    key: text(author.key),
    name: text(author.name),
    headline: text(author.headline),
    profileUrl: text(author.profileUrl),
  };
}

function dropView(row: DropRow): DropView {
  const post = readPostPayload(row.payload);
  return {
    rawItemId: row.rawItemId,
    reason: row.reason,
    ...parseDropReason(row.reason),
    postedAt: post.postedAt,
    // Raw payload text: only an http(s) URL may reach a link.
    url: post.url ? (httpUrl(post.url)?.toString() ?? null) : null,
    author: authorView(authorOf(post.author)),
  };
}

function heldView(row: HeldPostRow): HeldPostView {
  const post = row.post ?? {};
  const author =
    post['author'] && typeof post['author'] === 'object'
      ? (post['author'] as Record<string, unknown>)
      : {};
  return {
    jobId: row.jobId,
    url: row.postingUrl,
    author: authorView(author),
    postedAt: typeof post['postedAt'] === 'string' ? post['postedAt'] : null,
  };
}

@Injectable()
export class PrepareReviewService {
  constructor(
    private readonly review: PrepareReviewRepository,
    private readonly silenced: SilencedAuthorsRepository,
  ) {}

  async drops(query: {
    rule: string | null;
    before: string | null;
    limit: number;
  }): Promise<Page<DropView>> {
    const before = query.before ? decodeDropCursor(query.before) : null;
    if (query.before && !before)
      throw new BadRequestException('before is not a valid cursor');
    const rows = await this.review.drops({
      rule: query.rule,
      before,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(dropView),
      next:
        rows.length > query.limit && last
          ? encodeDropCursor({
              lastSeenAt: last.lastSeenAt,
              id: last.rawItemId,
            })
          : null,
    };
  }

  async silencedPosts(query: {
    before: string | null;
    limit: number;
  }): Promise<Page<HeldPostView>> {
    if (query.before && !UUID_RE.test(query.before))
      throw new BadRequestException('before is not a valid cursor');
    const ids = await this.silenced.silencedPostJobIds({
      before: query.before,
      limit: query.limit + 1,
    });
    const pageIds = ids.slice(0, query.limit);
    const rows = await this.review.heldPosts(pageIds);
    return {
      items: rows.map(heldView),
      next: ids.length > query.limit ? (pageIds.at(-1) ?? null) : null,
    };
  }

  async silencedAuthors(): Promise<SilencedAuthorView[]> {
    const rows = await this.silenced.list();
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  silence(
    adminId: string,
    input: { authorKey: string; name: string | null; reason: string },
  ): Promise<'silenced' | 'already'> {
    return this.silenced.silence({
      ...input,
      origin: 'manual',
      evidence: null,
      createdBy: adminId,
    });
  }

  async unsilence(authorKey: string): Promise<void> {
    if (!(await this.silenced.unsilence(authorKey)))
      throw new NotFoundException('That author is not silenced');
  }
}
