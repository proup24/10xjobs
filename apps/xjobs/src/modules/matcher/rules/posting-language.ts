import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { restsOn, type Check, type MatchProfile } from './types';

/**
 * Codes that name one language for this rule: the vocabulary has `no` beside `nb` and `nn`.
 * Every other pair of languages, however close, stays distinct.
 */
const SAME_LANGUAGE: Record<string, string> = {
  no: 'no',
  nb: 'no',
  nn: 'no',
};
const family = (code: string) => SAME_LANGUAGE[code] ?? code;

/**
 * The profile speaks one of the languages the posting is written in, at any level
 * (Norwegian `no`/`nb`/`nn` count as one; every other match is exact).
 * A close call (the detector can't tell, say, Danish from Bokmål) is unknown when the
 * profile speaks any member and a fail when it speaks none.
 * Never unsure: the detector's own doubt makes the check unknown, not a review.
 */
export function checkPostingLanguage(
  facts: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const { codes, closeCalls, confident } = facts.postingLanguages;
  const base = {
    rule: 'postingLanguage' as const,
    jobValue: facts.postingLanguages,
    profileValue: profile.languages.map((l) => l.lang),
    ...restsOn(null),
  };
  if (!confident || (codes.length === 0 && closeCalls.length === 0))
    return {
      ...base,
      outcome: 'unknown',
      reason: 'posting language not detected with confidence',
    };
  const spoken = new Set(profile.languages.map((l) => family(l.lang)));
  const shared = codes.filter((c) => spoken.has(family(c)));
  if (shared.length > 0)
    return {
      ...base,
      outcome: 'pass',
      reason: `posting is written in ${shared.join(', ')}, which you speak`,
    };
  const doubtful = closeCalls.find((set) =>
    set.some((c) => spoken.has(family(c))),
  );
  if (doubtful)
    return {
      ...base,
      outcome: 'unknown',
      reason: `posting is in one of ${doubtful.join(', ')}; can't tell which`,
    };
  const written = [
    ...codes,
    ...closeCalls.map((set) => `one of ${set.join('/')}`),
  ];
  return {
    ...base,
    outcome: 'fail',
    reason: `posting is written in ${written.join(', ')}, which you don't speak`,
  };
}
