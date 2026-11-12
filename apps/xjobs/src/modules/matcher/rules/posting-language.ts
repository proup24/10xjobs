import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { restsOn, type Check, type MatchProfile } from './types';

/**
 * Codes that name one language for this rule: the vocabulary has `no` beside `nb` and `nn`,
 * and the detector can't reliably tell Croatian, Serbian and Bosnian apart.
 */
const SAME_LANGUAGE: Record<string, string> = {
  no: 'no',
  nb: 'no',
  nn: 'no',
  hr: 'hbs',
  sr: 'hbs',
  bs: 'hbs',
};
const family = (code: string) => SAME_LANGUAGE[code] ?? code;

/**
 * The profile speaks one of the languages the posting is written in, at any level
 * (Norwegian `no`/`nb`/`nn` count as one, as do `hr`/`sr`/`bs`).
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
  const spoken = new Set(profile.languages.map((l) => family(l.lang)));
  const shared = codes.filter((c) => spoken.has(family(c)));
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
