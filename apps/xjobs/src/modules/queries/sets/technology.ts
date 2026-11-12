import { isSearchableTech } from '@xjobs/database/enums';
import type { RankedSkill, TechnologySet } from '../types';


/** Importance desc, mastery desc, then technology name asc. */
const compareSkills = (a: RankedSkill, b: RankedSkill): number =>
  b.importance - a.importance ||
  b.mastery - a.mastery ||
  a.technology.localeCompare(b.technology);

/** True when the technology has search wording; a concept tag such as `saas` has none. */
export const hasSearchWording = (technology: string): boolean =>
  isSearchableTech(technology);

/**
 * The user's best searchable skills: importance 0 and techs without search
 * wording dropped, each technology kept once at its best-ranked entry.
 */
export function topSkills(skills: RankedSkill[]): RankedSkill[] {
  const best = new Map<string, RankedSkill>();
  for (const skill of skills
    .filter((skill) => skill.importance > 0)
    .filter((skill) => hasSearchWording(skill.technology))
    .sort(compareSkills))
    if (!best.has(skill.technology)) best.set(skill.technology, skill);
  return [...best.values()];
}

/** The user's best technologies; see {@link topSkills}. */
export function topTechnologies(skills: RankedSkill[]): string[] {
  return topSkills(skills).map((skill) => skill.technology);
}

/** Each top technology alone, never combined, under the domain of its best-ranked entry. */
export function technologySets(skills: RankedSkill[]): TechnologySet[] {
  return topSkills(skills).map(({ technology, domain }) => ({
    technologies: [technology],
    domain,
  }));
}
