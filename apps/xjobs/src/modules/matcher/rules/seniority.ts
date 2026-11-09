import type { ExtractionDocument } from 'src/modules/processor/schema';
import { SENIORITY_YEARS_MARGIN } from '../config/matcher.config';
import type { Check, MatchProfile } from './types';

export function checkSeniority(
  doc: ExtractionDocument,
  profile: MatchProfile,
): Check {
  const seniority = doc.seniority.value ?? null;
  const minYears = doc.yearsRequired.value?.min ?? null;
  const check = (
    outcome: Check['outcome'],
    jobValue: unknown,
    reason: string,
  ): Check => ({
    rule: 'seniority',
    outcome,
    jobValue,
    profileValue: profile.seniorities,
    reason,
  });
  const wanted = `[${profile.seniorities.join(', ')}]`;

  if (seniority !== null && seniority !== 'unstated') {
    return profile.seniorities.includes(seniority)
      ? check(
          'pass',
          seniority,
          `job seniority ${seniority} is in your seniorities ${wanted}`,
        )
      : check(
          'fail',
          seniority,
          `job seniority ${seniority} is not in your seniorities ${wanted}`,
        );
  }
  if (
    minYears !== null &&
    minYears > profile.yearsOfExperience + SENIORITY_YEARS_MARGIN
  ) {
    return check(
      'fail',
      { seniority, yearsRequired: minYears },
      `job asks for ${minYears}+ years; you have ${profile.yearsOfExperience}`,
    );
  }
  return check(
    'unknown',
    { seniority, yearsRequired: minYears },
    'job does not state its seniority',
  );
}
