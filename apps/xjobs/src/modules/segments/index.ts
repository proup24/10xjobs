export { SearchSegmentsModule } from './segments.module';
export {
  SearchSegmentsRepository,
  type NewCollectionBatch,
  type NewSegmentRun,
  type SegmentQueryOutcome,
  type SegmentRunStatus,
} from './repositories/segments.repository';
export {
  SEGMENT_SIZE,
  buildSegments,
  segmentKey,
  type SearchSegment,
} from './services/segments';
export { segmentWindow, type SegmentWindow, type WindowConfig } from './services/window';
