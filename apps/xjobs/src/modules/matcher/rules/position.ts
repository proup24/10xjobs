import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { restsOn, type Check, type MatchProfile } from './types';

export function checkPosition(
  doc: JobFactsDocument,
  profile: MatchProfile,
): Check {
  const roleKind = doc.position.value?.roleKind ?? null;
  const check = (
    outcome: Check['outcome'],
    jobValue: unknown,
    reason: string,
    unsureField: string | null = null,
  ): Check => ({
    rule: 'position',
    outcome,
    jobValue,
    profileValue: profile.position,
    reason,
    ...restsOn(unsureField),
  });
  const positionUnsure =
    doc.position.confidence === 'unsure' ? 'position' : null;

  if (doc.isSoftwareEngineeringRole.value === false) {
    return check(
      'fail',
      roleKind,
      `job is not a software engineering role; you want ${profile.position}`,
      doc.isSoftwareEngineeringRole.confidence === 'unsure'
        ? 'isSoftwareEngineeringRole'
        : null,
    );
  }
  if (roleKind === profile.position) {
    return check(
      'pass',
      roleKind,
      `job role ${roleKind} matches your position`,
      positionUnsure ??
        (doc.isSoftwareEngineeringRole.confidence === 'unsure'
          ? 'isSoftwareEngineeringRole'
          : null),
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
    positionUnsure,
  );
}
