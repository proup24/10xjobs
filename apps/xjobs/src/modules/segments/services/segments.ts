import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  linkedinGroupKey,
  linkedinMemberWords,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { linkedinKeywordFits } from 'src/modules/queries/channels/linkedin_keyword';

/** Builders searched together in one Apify run. */
export interface SearchSegment {
  /**
   * `channel|domain|type|place`: what every member shares. For the LinkedIn
   * job board, `channel|type|group:<place and filters>`.
   */
  key: string;
  /** sha256 of the key and the ordered member ids: the segment's identity. */
  hash: string;
  channel: Channel;
  members: QuerySearchBuilderRow[];
}

export const SEGMENT_SIZE = 10;

/**
 * The group a LinkedIn job board builder searches in (`linkedinGroupKey`):
 * place and filters, whatever its keyword. A builder whose place can't be
 * resolved (no geoId) gets a segment of its own, keyed so it can't collide with
 * a real group: its run fails loudly, naming the place, and every other
 * segment still runs.
 */
function linkedinJobBoardKey(builder: QuerySearchBuilderRow): string {
  const prefix = `${builder.channel}|${builder.type}`;
  try {
    return `${prefix}|group:${linkedinGroupKey(params(builder))}`;
  } catch {
    return `${prefix}|unresolved:${builder.id}`;
  }
}

function params(builder: QuerySearchBuilderRow): Record<string, unknown> {
  return (builder.params ?? {}) as Record<string, unknown>;
}

/**
 * Builders share channel, domain, arrangement and the location they search.
 * LinkedIn job board builders share their place and filters instead, without
 * domain: their keywords merge into one search.
 */
export function segmentKey(builder: QuerySearchBuilderRow): string {
  if (builder.channel === Channel.LINKEDIN_JOB_BOARD)
    return linkedinJobBoardKey(builder);
  return [builder.channel, builder.domain, builder.type, builder.location].join(
    '|',
  );
}

/** sha256 of the key and the ordered member ids: a segment's identity. */
export function segmentHash(key: string, memberIds: readonly string[]): string {
  return createHash('sha256')
    .update([key, ...memberIds].join('\n'))
    .digest('hex');
}

function byHash(a: QuerySearchBuilderRow, b: QuerySearchBuilderRow): number {
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/** `count` consecutive chunks, as even as possible, larger ones first. */
function evenChunks<T>(items: readonly T[], count: number): T[][] {
  const n = Math.max(1, Math.min(count, items.length));
  const chunks: T[][] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const length =
      Math.floor(items.length / n) + (i < items.length % n ? 1 : 0);
    chunks.push(items.slice(start, start + length));
    start += length;
  }
  return chunks;
}

function keywordFits(members: readonly QuerySearchBuilderRow[]): boolean {
  const { roleWords, spellings } = linkedinMemberWords(
    members.map((member) => ({ params: params(member) })),
  );
  // Members with no words can't build a keyword; the collector fails them.
  if (roleWords.length === 0 || spellings.length === 0) return true;
  return linkedinKeywordFits(roleWords, spellings);
}

/** Halves a chunk until its merged keyword fits or it holds one member. */
function fitChunks(
  members: QuerySearchBuilderRow[],
): QuerySearchBuilderRow[][] {
  if (members.length <= 1 || keywordFits(members)) return [members];
  const half = Math.ceil(members.length / 2);
  return [
    ...fitChunks(members.slice(0, half)),
    ...fitChunks(members.slice(half)),
  ];
}

/**
 * Groups builders by segment key and orders each group by builder hash. A
 * LinkedIn job board group is cut into `parts.get(key) ?? 1` even chunks, then
 * any chunk whose merged keyword is too long is halved; `size` doesn't apply.
 * Other groups are cut into segments of at most `size`. The same builders
 * always give the same segments, whatever their input order.
 */
export function buildSegments(
  builders: readonly QuerySearchBuilderRow[],
  size = SEGMENT_SIZE,
  parts: ReadonlyMap<string, number> = new Map(),
): SearchSegment[] {
  const groups = new Map<string, QuerySearchBuilderRow[]>();
  for (const builder of builders) {
    const key = segmentKey(builder);
    groups.set(key, [...(groups.get(key) ?? []), builder]);
  }
  const segments: SearchSegment[] = [];
  for (const key of [...groups.keys()].sort()) {
    const members = (groups.get(key) ?? []).sort(byHash);
    const chunks: QuerySearchBuilderRow[][] =
      members[0].channel === Channel.LINKEDIN_JOB_BOARD
        ? evenChunks(members, parts.get(key) ?? 1).flatMap(fitChunks)
        : Array.from({ length: Math.ceil(members.length / size) }, (_, i) =>
            members.slice(i * size, (i + 1) * size),
          );
    for (const chunk of chunks)
      segments.push({
        key,
        hash: segmentHash(
          key,
          chunk.map((member) => member.id),
        ),
        channel: chunk[0].channel as Channel,
        members: chunk,
      });
  }
  return segments;
}
