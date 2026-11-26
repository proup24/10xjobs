import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { POSITION_TITLES } from 'src/modules/queries/builders/keywords';
import { restsOn, type Check, type MatchProfile } from './types';

/**
 * Role kinds a lead-level seniority lets a `tech_lead` profile pass: the software
 * engineering kinds the profile positions name. `other` (not engineering work) and
 * `engineering_manager` (people management, not leading engineers by building) are left
 * out, and `unstated` is not a kind. `tech_lead` itself passes by the exact-kind rule.
 */
const LEAD_PASS_KINDS: ReadonlySet<string> = new Set(
  Object.keys(POSITION_TITLES).filter((k) => k !== 'engineering_manager'),
);

/**
 * A not-software-engineering failure on an unsure flag is unsure only when it might not
 * hold: with the flag true, the role would have to pass or be unknown. A role that is
 * another one, and surely so, still fails; an unstated role with an unknown stack
 * (`stackUnknown`) still fails on "neither role nor stack" (see `decide`).
 */
export function checkPosition(
  doc: JobFactsDocument,
  profile: MatchProfile,
  stackUnknown = false,
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

  const unstated = roleKind === null || roleKind === 'unstated';

  if (doc.isSoftwareEngineeringRole.value === false) {
    let unsureField: string | null = null;
    if (doc.isSoftwareEngineeringRole.confidence === 'unsure') {
      if (roleKind === profile.position)
        unsureField = 'isSoftwareEngineeringRole';
      else if (unstated)
        unsureField = stackUnknown ? null : 'isSoftwareEngineeringRole';
      else unsureField = positionUnsure;
    }
    return check(
      'fail',
      roleKind,
      `job is not a software engineering role; you want ${profile.position}`,
      unsureField,
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
  if (
    profile.position === 'tech_lead' &&
    profile.seniorities.includes('lead') &&
    roleKind !== null &&
    LEAD_PASS_KINDS.has(roleKind) &&
    doc.seniority.value === 'lead'
  ) {
    return check(
      'pass',
      roleKind,
      `lead-level ${roleKind} counts for tech_lead`,
      positionUnsure ??
        (doc.seniority.confidence === 'unsure' ? 'seniority' : null) ??
        (doc.isSoftwareEngineeringRole.value === null ||
        doc.isSoftwareEngineeringRole.confidence === 'unsure'
          ? 'isSoftwareEngineeringRole'
          : null),
    );
  }
  if (unstated) {
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
