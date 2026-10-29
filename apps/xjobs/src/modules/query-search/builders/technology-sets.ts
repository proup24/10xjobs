import type { Technology } from 'src/common/enums';
import type { RankedSkill } from '../types';

export const QUERY_SEARCH_TOP_TECHNOLOGIES = 3;

/** Importance desc, preference desc, mastery desc, then technology name asc. */
const compareSkills = (a: RankedSkill, b: RankedSkill): number =>
  b.importance - a.importance ||
  b.preference - a.preference ||
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

/** Singles, then the top two together, then the top three together. */
export function technologySets(skills: RankedSkill[]): Technology[][] {
  const top = topTechnologies(skills);
  if (top.length === 0) return [[]];
  const sets = top.map((technology) => [technology]);
  if (top.length >= 2) sets.push(top.slice(0, 2));
  if (top.length >= 3) sets.push(top.slice(0, 3));
  return sets;
}
