import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { restsOn, type Check, type MatchProfile } from './types';

/**
 * The profile speaks one of the languages the posting is written in, at any level.
 * Never unsure: the detector's own doubt makes the check unknown, not a review.
 */
export function checkPostingLanguage(
  facts: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const { codes, confident } = facts.postingLanguages;
  const base = {
    rule: 'postingLanguage' as const,
    jobValue: facts.postingLanguages,
    profileValue: profile.languages.map((l) => l.lang),
    ...restsOn(null),
  };
  if (!confident || codes.length === 0)
    return {
      ...base,
      outcome: 'unknown',
      reason: 'posting language not detected with confidence',
    };
  const spoken = new Set(profile.languages.map((l) => l.lang));
  const shared = codes.filter((c) => spoken.has(c));
  return shared.length > 0
    ? {
        ...base,
        outcome: 'pass',
        reason: `posting is written in ${shared.join(', ')}, which you speak`,
      }
    : {
        ...base,
        outcome: 'fail',
        reason: `posting is written in ${codes.join(', ')}, which you don't speak`,
      };
}
