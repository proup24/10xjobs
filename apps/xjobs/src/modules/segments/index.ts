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
  type UnsettledCost,
} from './repositories/segments.repository';
export {
  LinkedinSearchSplitsRepository,
  PrismaLinkedinSearchSplitsRepository,
} from './repositories/splits.repository';
export {
  SEGMENT_SIZE,
  buildSegments,
  keywordUnits,
  planSegments,
  segmentHash,
  segmentKey,
  type KeywordCut,
  type OversizedSegment,
  type SearchSegment,
  type SegmentPlan,
} from './services/segments';
export { longestWaitingFirst } from './services/run-order';
export {
  segmentWindow,
  type SegmentWindow,
  type WindowConfig,
} from './services/window';
export {
  PostsBudgetService,
  type PostsBudgetDay,
} from './services/posts-budget';
export {
  DailyBudget,
  POSTS_MIN_LEFT_USD,
  POSTS_NULL_COST_MICRO_USD,
  moroccoDayStart,
  nextMoroccoDayStart,
  postsBudgetReached,
} from './services/spend';
