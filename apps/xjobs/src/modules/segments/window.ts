import type { QuerySearchBuilderRow } from 'src/database';

export interface WindowConfig {
  /** Look-back for a builder that was never collected. */
  initialHours: number;
  /** Re-searched before the oldest cursor, so late-indexed postings are caught. */
  overlapMinutes: number;
  /** Longest window one run searches; anything older is not caught up. */
  maximumHours: number;
}

export interface SegmentWindow {
  since: Date;
  until: Date;
  /** True when the members' uncovered span was longer than the maximum. */
  clipped: boolean;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * The span a segment searches: from its oldest member cursor minus the overlap
 * (or the initial look-back for a never-collected member), up to `until`, at
 * most `maximumHours` long.
 */
export function segmentWindow(
  members: readonly Pick<QuerySearchBuilderRow, 'coveredUntil'>[],
  until: Date,
  config: WindowConfig,
): SegmentWindow {
  const end = until.getTime();
  const overlap = config.overlapMinutes * MINUTE;
  // A never-collected member starts at the initial look-back; a collected one at
  // its cursor minus the overlap. A future cursor (clock skew) is treated as now.
  const start = Math.min(
    ...members.map((member) =>
      member.coveredUntil
        ? Math.min(member.coveredUntil.getTime(), end) - overlap
        : end - config.initialHours * HOUR,
    ),
  );
  const earliest = end - config.maximumHours * HOUR;
  return {
    since: new Date(Math.max(start, earliest)),
    until,
    clipped: start < earliest,
  };
}
