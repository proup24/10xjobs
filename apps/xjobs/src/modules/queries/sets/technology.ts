import type { Technology } from 'src/common/enums';
import type { RankedSkill, TechnologySet } from '../types';

export const QUERY_SEARCH_TOP_TECHNOLOGIES = 2;

/** Importance desc, mastery desc, then technology name asc. */
const compareSkills = (a: RankedSkill, b: RankedSkill): number =>
  b.importance - a.importance ||
  b.mastery - a.mastery ||
  a.technology.localeCompare(b.technology);

/** The user's best skills: importance 0 dropped, each technology kept once at its best-ranked entry. */
export function topSkills(skills: RankedSkill[]): RankedSkill[] {
  const best = new Map<Technology, RankedSkill>();
  for (const skill of skills
    .filter((skill) => skill.importance > 0)
    .sort(compareSkills))
    if (!best.has(skill.technology)) best.set(skill.technology, skill);
  return [...best.values()].slice(0, QUERY_SEARCH_TOP_TECHNOLOGIES);
}

/** The user's best technologies; see {@link topSkills}. */
export function topTechnologies(skills: RankedSkill[]): Technology[] {
  return topSkills(skills).map((skill) => skill.technology);
}

/** Each top technology alone, never combined, under the domain of its best-ranked entry. */
export function technologySets(skills: RankedSkill[]): TechnologySet[] {
  return topSkills(skills).map(({ technology, domain }) => ({
    technologies: [technology],
    domain,
  }));
}
