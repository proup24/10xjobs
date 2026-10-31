import type { Technology } from 'src/common/enums';
import type { RankedSkill } from '../types';

export const QUERY_SEARCH_TOP_TECHNOLOGIES = 2;

/** Importance desc, mastery desc, then technology name asc. */
const compareSkills = (a: RankedSkill, b: RankedSkill): number =>
  b.importance - a.importance ||
  b.mastery - a.mastery ||
  a.technology.localeCompare(b.technology);

/** The user's best technologies: importance 0 dropped, each kept once at its highest rank. */
export function topTechnologies(skills: RankedSkill[]): Technology[] {
  const ranked = skills
    .filter((skill) => skill.importance > 0)
    .sort(compareSkills);
  const unique = new Set(ranked.map((skill) => skill.technology));
  return [...unique].slice(0, QUERY_SEARCH_TOP_TECHNOLOGIES);
}

/** Each top technology alone, never combined; `[[]]` (position only) when there are none. */
export function technologySets(skills: RankedSkill[]): Technology[][] {
  const top = topTechnologies(skills);
  if (top.length === 0) return [[]];
  return top.map((technology) => [technology]);
}
