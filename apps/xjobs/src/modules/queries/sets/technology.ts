import { isSearchableTech } from '@xjobs/database/enums';
import { Channel } from 'src/common/enums';
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

/**
 * The technology sets a channel searches. The LinkedIn job board gets one set
 * with every top technology (the keyword ORs their spellings), under the
 * domain of the first top skill. Other channels get each technology alone,
 * under the domain of its best-ranked entry.
 */
export function technologySets(
  skills: RankedSkill[],
  channel: Channel,
): TechnologySet[] {
  const top = topSkills(skills);
  if (channel === Channel.LINKEDIN_JOB_BOARD)
    return top.length === 0
      ? []
      : [
          {
            technologies: top.map((skill) => skill.technology),
            domain: top[0].domain,
          },
        ];
  return top.map(({ technology, domain }) => ({
    technologies: [technology],
    domain,
  }));
}
