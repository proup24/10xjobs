import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  linkedinGroupKey,
  linkedinMemberWords,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import {
  keywordTerm,
  linkedinKeyword,
  linkedinKeywordFits,
} from 'src/modules/queries/channels/linkedin_keyword';

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

/** A LinkedIn job board group cut into more chunks than its parts because its keyword was too long. */
export interface KeywordCut {
  key: string;
  members: number;
  chunks: number;
}

/** A one-member LinkedIn job board segment whose own keyword is still over the limit. */
export interface OversizedSegment {
  key: string;
  hash: string;
  /** Characters of its keyword. */
  length: number;
  /** Distinct terms of its keyword. */
  terms: number;
}

/** The segments of a tick, and what keyword length did to them, for the caller to log. */
export interface SegmentPlan {
  segments: SearchSegment[];
  cuts: KeywordCut[];
  oversized: OversizedSegment[];
}

/** The keyword's length and terms when a lone member's words don't fit; null when they do. */
function overLimit(
  member: QuerySearchBuilderRow,
): { length: number; terms: number } | null {
  if (keywordFits([member])) return null;
  const { roleWords, spellings } = linkedinMemberWords([
    { params: params(member) },
  ]);
  return {
    length: linkedinKeyword(roleWords, spellings).length,
    terms: new Set([...roleWords, ...spellings].map(keywordTerm)).size,
  };
}

/**
 * Groups builders by segment key and orders each group by builder hash. A
 * LinkedIn job board group is cut into `parts.get(key) ?? 1` even chunks, then
 * any chunk whose merged keyword is too long is halved; `size` doesn't apply.
 * Other groups are cut into segments of at most `size`. The same builders
 * always give the same segments, whatever their input order. Pure: it reports
 * the groups keyword length cut, and the lone builders still over the limit
 * (sent anyway: they can't be cut), and the caller logs them.
 */
export function planSegments(
  builders: readonly QuerySearchBuilderRow[],
  size = SEGMENT_SIZE,
  parts: ReadonlyMap<string, number> = new Map(),
): SegmentPlan {
  const groups = new Map<string, QuerySearchBuilderRow[]>();
  for (const builder of builders) {
    const key = segmentKey(builder);
    groups.set(key, [...(groups.get(key) ?? []), builder]);
  }
  const plan: SegmentPlan = { segments: [], cuts: [], oversized: [] };
  for (const key of [...groups.keys()].sort()) {
    const members = (groups.get(key) ?? []).sort(byHash);
    const board = members[0].channel === Channel.LINKEDIN_JOB_BOARD;
    let chunks: QuerySearchBuilderRow[][];
    if (board) {
      const even = evenChunks(members, parts.get(key) ?? 1);
      chunks = even.flatMap(fitChunks);
      if (chunks.length > even.length)
        plan.cuts.push({ key, members: members.length, chunks: chunks.length });
    } else
      chunks = Array.from(
        { length: Math.ceil(members.length / size) },
        (_, i) => members.slice(i * size, (i + 1) * size),
      );
    for (const chunk of chunks) {
      const segment: SearchSegment = {
        key,
        hash: segmentHash(
          key,
          chunk.map((member) => member.id),
        ),
        channel: chunk[0].channel as Channel,
        members: chunk,
      };
      plan.segments.push(segment);
      const over = board && chunk.length === 1 ? overLimit(chunk[0]) : null;
      if (over) plan.oversized.push({ key, hash: segment.hash, ...over });
    }
  }
  return plan;
}

/** The segments of {@link planSegments}, without its report. */
export function buildSegments(
  builders: readonly QuerySearchBuilderRow[],
  size = SEGMENT_SIZE,
  parts: ReadonlyMap<string, number> = new Map(),
): SearchSegment[] {
  return planSegments(builders, size, parts).segments;
}
