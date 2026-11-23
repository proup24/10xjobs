import { Channel } from 'src/common/enums';
import type { SearchSegment } from 'src/modules/segments';

/** What one collect job did across the channel's segments. */
export interface CollectionSummary {
  channel: Channel;
  /** Builders the tick may run: the active ones, less the paused. */
  builders: number;
  /** Active builders left out because every owner is paused. */
  buildersPaused: number;
  /** Builders no longer paused, whose cursors moved to the resume point. */
  buildersWoken: number;
  /** Segments built, plus one for each LinkedIn search halved in this run. */
  segments: number;
  segmentsFailed: number;
  /** Segments not searched: another run holds, or already covered, every member. */
  segmentsSkipped: number;
  /** Segments not started because the worker was shutting down or the daily budget was reached. */
  segmentsDeferred: number;
  /** Members dropped from their segment for the same reasons. */
  queriesSkipped: number;
  /** Items returned, attributed or not. */
  collected: number;
  /** Batches stored for ingest. */
  batches: number;
  costUsd: number;
}

/** Cost is retained even when the fetched results could not be stored. */
export interface SegmentOutcome {
  /** True when no member could be claimed; nothing was searched. */
  skipped: boolean;
  queriesSkipped: number;
  stored: boolean;
  collected: number;
  costUsd: number;
  /** The stored run was full: it returned its row limit, or the source reported more. */
  truncated: boolean;
  /** The run stopped at its cost cap, so it kept its cursors. Absent when nothing was stored. */
  capped?: boolean;
  /** Rows the stored run returned. */
  fetched: number;
  /** The members actually searched, once claimed; null when nothing was searched. */
  searched: SearchSegment | null;
}
