import { BadRequestException } from '@nestjs/common';
import { hasSearchWording } from '../sets/technology';
import type { QuerySearchProfileInput, RankedSkill } from '../types';

export const SKILLS_REQUIRED =
  'at least one searchable technology with importance above 0 is required to publish';

/**
 * True when at least one skill can be searched: importance above 0 and a
 * technology with search wording. Concept tags such as `saas` count for
 * qualify, not for search.
 */
export function hasRankedSkill(skills: readonly RankedSkill[]): boolean {
  return skills.some(
    (skill) => skill.importance > 0 && hasSearchWording(skill.technology),
  );
}

/** Every builder takes its technology and domain from a searchable skill, so a profile needs one to publish. */
export function assertHasSkills(profile: QuerySearchProfileInput): void {
  if (!hasRankedSkill(profile.skills))
    throw new BadRequestException(SKILLS_REQUIRED);
}
