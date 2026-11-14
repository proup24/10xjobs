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
  segmentHash,
  segmentKey,
  type SearchSegment,
} from './services/segments';
export {
  segmentWindow,
  type SegmentWindow,
  type WindowConfig,
} from './services/window';
