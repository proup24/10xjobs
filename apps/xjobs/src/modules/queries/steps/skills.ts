import { BadRequestException } from '@nestjs/common';
import type { QuerySearchProfileInput, RankedSkill } from '../types';

export const SKILLS_REQUIRED =
  'at least one skill with importance above 0 is required to publish';

/** True when at least one skill can be searched (importance above 0). */
export function hasRankedSkill(skills: readonly RankedSkill[]): boolean {
  return skills.some((skill) => skill.importance > 0);
}

/** Every builder takes its domain from a skill, so a profile needs one to publish. */
export function assertHasSkills(profile: QuerySearchProfileInput): void {
  if (!hasRankedSkill(profile.skills))
    throw new BadRequestException(SKILLS_REQUIRED);
}
