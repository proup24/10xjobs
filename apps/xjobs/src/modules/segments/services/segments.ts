import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { linkedinSearchKey } from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';

/** Builders searched together in one Apify run. */
export interface SearchSegment {
  /**
   * `channel|domain|type|place`: what every member shares. For the LinkedIn
   * job board, `place` is the whole search.
   */
  key: string;
  /** sha256 of the key and the ordered member ids: the segment's identity. */
  hash: string;
  channel: Channel;
  members: QuerySearchBuilderRow[];
}

export const SEGMENT_SIZE = 10;

/**
 * The exact search a LinkedIn job board builder runs (`linkedinSearchKey`): one
 * segment is one search, so the actor's results belong to every member and a
 * search's row limit and charge cap are its own.
 */
function linkedinJobBoardSearch(builder: QuerySearchBuilderRow): string {
  const params = (builder.params ?? {}) as Record<string, unknown>;
  return `search:${linkedinSearchKey(builder.keyword, params)}`;
}

/**
 * Builders share the location they search, whatever the arrangement (the
 * arrangement is its own part of the key). LinkedIn job board builders share
 * their whole search instead: keyword, place and filters.
 */
function placeOf(builder: QuerySearchBuilderRow): string {
  return builder.channel === Channel.LINKEDIN_JOB_BOARD
    ? linkedinJobBoardSearch(builder)
    : builder.location;
}

export function segmentKey(builder: QuerySearchBuilderRow): string {
  return [builder.channel, builder.domain, builder.type, placeOf(builder)].join(
    '|',
  );
}

/** sha256 of the key and the ordered member ids: a segment's identity. */
export function segmentHash(key: string, memberIds: readonly string[]): string {
  return createHash('sha256')
    .update([key, ...memberIds].join('\n'))
    .digest('hex');
}

/**
 * Groups builders by channel, domain, arrangement and place, orders each group
 * by builder hash and cuts it into segments of at most `size`. The same
 * builders always give the same segments, whatever their input order.
 */
export function buildSegments(
  builders: readonly QuerySearchBuilderRow[],
  size = SEGMENT_SIZE,
): SearchSegment[] {
  const groups = new Map<string, QuerySearchBuilderRow[]>();
  for (const builder of builders) {
    const key = segmentKey(builder);
    groups.set(key, [...(groups.get(key) ?? []), builder]);
  }
  const segments: SearchSegment[] = [];
  for (const key of [...groups.keys()].sort()) {
    const members = (groups.get(key) ?? []).sort((a, b) =>
      a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
    );
    for (let start = 0; start < members.length; start += size) {
      const chunk = members.slice(start, start + size);
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
  }
  return segments;
}
