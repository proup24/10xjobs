import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import {
  restsOn,
  type Check,
  type LanguageLevel,
  type MatchProfile,
} from './types';

const RANK: Record<LanguageLevel, number> = {
  working: 0,
  fluent: 1,
  native: 2,
};

/** Every language the job requires, held at or above its level. */
export function checkRequiredLanguages(
  facts: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const required = (facts.requiredLanguages.value ?? []).map(
    ({ lang, level }) => ({ lang, level }),
  );
  const base = {
    rule: 'languages' as const,
    jobValue: required,
    profileValue: profile.languages,
  };
  // Pass or fail, the outcome rests on the stated requirements.
  const sureness = restsOn(
    facts.requiredLanguages.confidence === 'unsure'
      ? 'requiredLanguages'
      : null,
  );
  if (required.length === 0)
    return {
      ...base,
      // Nothing to check: a pass, never review or a reject. On an unsure fact a
      // requirement may have been missed, so the pass rests on it (unverified).
      outcome: 'pass',
      reason: 'job requires no language',
      ...sureness,
    };
  const held = new Map(profile.languages.map((l) => [l.lang, l.level]));
  const short = required.flatMap(({ lang, level }) => {
    const have = held.get(lang);
    if (have === undefined) return [`${lang} (${level}; you don't speak it)`];
    return RANK[have] < RANK[level]
      ? [`${lang} (${level}; you have ${have})`]
      : [];
  });
  const asked = required.map((r) => `${r.lang} (${r.level})`).join(', ');
  return short.length === 0
    ? {
        ...base,
        outcome: 'pass',
        reason: `you speak every required language: ${asked}`,
        ...sureness,
      }
    : {
        ...base,
        outcome: 'fail',
        reason: `job requires ${short.join(', ')}`,
        detail: { short },
        ...sureness,
      };
}
