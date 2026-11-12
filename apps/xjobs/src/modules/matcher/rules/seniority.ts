import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { SENIORITY_YEARS_MARGIN } from '../config/matcher.config';
import type { Check, MatchProfile } from './types';

export function checkSeniority(
  doc: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const seniority = doc.seniority.value ?? null;
  const minYears = doc.yearsRequired.value?.min ?? null;
  const check = (
    outcome: Check['outcome'],
    jobValue: unknown,
    reason: string,
    unsureField: string | null = null,
  ): Check => ({
    rule: 'seniority',
    outcome,
    jobValue,
    profileValue: profile.seniorities,
    reason,
    unsure: unsureField !== null,
    unsureField,
  });
  const wanted = `[${profile.seniorities.join(', ')}]`;

  if (seniority !== null && seniority !== 'unstated') {
    const unsureField =
      doc.seniority.confidence === 'unsure' ? 'seniority' : null;
    return profile.seniorities.includes(seniority)
      ? check(
          'pass',
          seniority,
          `job seniority ${seniority} is in your seniorities ${wanted}`,
          unsureField,
        )
      : check(
          'fail',
          seniority,
          `job seniority ${seniority} is not in your seniorities ${wanted}`,
          unsureField,
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
      doc.yearsRequired.confidence === 'unsure' ? 'yearsRequired' : null,
    );
  }
  return check(
    'unknown',
    { seniority, yearsRequired: minYears },
    'job does not state its seniority',
  );
}
