export { SearchSegmentsModule } from './segments.module';
export {
  SearchSegmentsRepository,
  type ClaimResult,
  type ClaimSkipReason,
  type ClaimWindow,
  type NewCollectionBatch,
  type NewSegmentRun,
  type SegmentQueryOutcome,
  type SegmentRunStatus,
} from './repositories/segments.repository';
export {
  LinkedinSearchSplitsRepository,
  PrismaLinkedinSearchSplitsRepository,
} from './repositories/splits.repository';
export {
  SEGMENT_SIZE,
  buildSegments,
  planSegments,
  segmentHash,
  segmentKey,
  type KeywordCut,
  type OversizedSegment,
  type SearchSegment,
  type SegmentPlan,
} from './services/segments';
export {
  segmentWindow,
  type SegmentWindow,
  type WindowConfig,
} from './services/window';
