export { normalize } from './normalize';
export {
  emptyRecord,
  NORMALIZER_VERSION,
  type NormalizedRecord,
  normalizedRecordSchema,
  type NormalizeResult,
  RECORD_FIELDS,
} from './record';
export { canonicalApplyUrl, jobKey } from './job-key';
export { type MergedJob, type MergeSource, mergeSources } from './merge';
export {
  nextProcessing,
  type ProcessingReason,
  type ProcessingState,
  type ProcessingStatus,
} from './processing';
