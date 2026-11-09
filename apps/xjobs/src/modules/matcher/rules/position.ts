import type { ExtractionDocument } from 'src/modules/processor/schema';
import type { Check, MatchProfile } from './types';

export function checkPosition(
  doc: ExtractionDocument,
  profile: MatchProfile,
): Check {
  const roleKind = doc.position.value?.roleKind ?? null;
  const check = (
    outcome: Check['outcome'],
    jobValue: unknown,
    reason: string,
  ): Check => ({
    rule: 'position',
    outcome,
    jobValue,
    profileValue: profile.position,
    reason,
  });

  if (doc.isSoftwareEngineeringRole.value === false) {
    return check(
      'fail',
      roleKind,
      `job is not a software engineering role; you want ${profile.position}`,
    );
  }
  if (roleKind === profile.position) {
    return check(
      'pass',
      roleKind,
      `job role ${roleKind} matches your position`,
    );
  }
  if (roleKind === null || roleKind === 'unstated') {
    return check(
      'unknown',
      roleKind,
      `job does not state its role; you want ${profile.position}`,
    );
  }
  return check(
    'fail',
    roleKind,
    `job role ${roleKind} is not your position ${profile.position}`,
  );
}
