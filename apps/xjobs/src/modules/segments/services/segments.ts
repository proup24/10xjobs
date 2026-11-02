import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';

/** Builders searched together in one Apify run. */
export interface SearchSegment {
  /** `channel|domain|type|place`: what every member shares. */
  key: string;
  /** sha256 of the key and the ordered member ids: the segment's identity. */
  hash: string;
  channel: Channel;
  members: QuerySearchBuilderRow[];
}

export const SEGMENT_SIZE = 10;

/** The place a LinkedIn job board builder searches: its geoId, else its location text. */
function linkedinSearchPlace(builder: QuerySearchBuilderRow): string | null {
  const params = (builder.params ?? {}) as Record<string, unknown>;
  const place = params.geoId ?? params.location;
  return typeof place === 'string' && place ? `search:${place}` : null;
}

/**
 * Builders share the location they search, whatever the arrangement (the
 * arrangement is its own part of the key). LinkedIn job board builders share
 * the place LinkedIn searches: its geoId, else its location text.
 */
function placeOf(builder: QuerySearchBuilderRow): string {
  if (builder.channel === Channel.LINKEDIN_JOB_BOARD) {
    const place = linkedinSearchPlace(builder);
    if (place) return place;
  }
  return builder.location;
}

export function segmentKey(builder: QuerySearchBuilderRow): string {
  return [builder.channel, builder.domain, builder.type, placeOf(builder)].join(
    '|',
  );
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
        hash: createHash('sha256')
          .update([key, ...chunk.map((member) => member.id)].join('\n'))
          .digest('hex'),
        channel: chunk[0].channel as Channel,
        members: chunk,
      });
    }
  }
  return segments;
}
