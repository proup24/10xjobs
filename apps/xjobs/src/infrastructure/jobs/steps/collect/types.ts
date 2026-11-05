import { Channel } from "src/common/enums";

/** What one collect job did across the channel's segments. */
export interface CollectionSummary {
  channel: Channel;
  builders: number;
  segments: number;
  segmentsFailed: number;
  /** Segments not searched: another run holds, or already covered, every member. */
  segmentsSkipped: number;
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
}