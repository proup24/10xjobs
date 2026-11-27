import type { SearchSegment } from './segments';

/**
 * Segments in the order to run them: any segment with a member that was never
 * covered first, then by its oldest member's `coveredUntil`, oldest first.
 * Ties keep the input order. Returns a new array.
 */
export function longestWaitingFirst(
  segments: readonly SearchSegment[],
): SearchSegment[] {
  const oldest = (segment: SearchSegment): number =>
    segment.members.some((member) => member.coveredUntil === null)
      ? -Infinity
      : Math.min(...segment.members.map((m) => m.coveredUntil!.getTime()));
  return segments
    .map((segment) => ({ segment, oldest: oldest(segment) }))
    .sort((a, b) => (a.oldest === b.oldest ? 0 : a.oldest < b.oldest ? -1 : 1))
    .map(({ segment }) => segment);
}
