export { MATCHER_VERSION } from './config/matcher.config';
export { MatcherModule } from './matcher.module';
export {
  MatcherRepository,
  type MatchCandidate,
  type StoredMatch,
} from './repositories/matcher.repository';
export { MatcherService, type MatchOutcome } from './services/matcher.service';
export type { Decision, MatchContext } from './rules/decide';
export type { Check, MatchJob, MatchProfile } from './rules/types';
