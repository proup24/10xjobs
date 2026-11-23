import type { SegmentQuery, SegmentSearch } from '../types/collector';
import { linkedinGroupKey } from '../providers/mappers/linkedin-job-board.mapper';
import { SearchNotStartedError } from './search-not-started';

/**
 * Builds a LinkedIn job board actor input for a segment that runs one search.
 * `build` gets the first member (members may spell a geoId-pinned place
 * differently; any one runs the search). Anything wrong (members that run
 * different searches by `key`, a place with no geoId, no words to search)
 * throws a {@link SearchNotStartedError}: no run started, nothing charged.
 */
export function oneSearchInput<T>(
  segment: SegmentSearch,
  build: (first: SegmentQuery) => T,
  key: (params: Record<string, unknown>) => string = linkedinGroupKey,
): T {
  try {
    const searches = new Set(segment.queries.map(({ params }) => key(params)));
    if (searches.size !== 1)
      throw new Error(
        `A LinkedIn job board segment runs one search; this one has ${searches.size}`,
      );
    return build(segment.queries[0]);
  } catch (error) {
    throw new SearchNotStartedError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
