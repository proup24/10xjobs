import { isSearchableTech } from '@xjobs/database/enums';
import { Channel, isLinkedinJobBoard } from 'src/common/enums';
import { searchSpellings } from '../builders/search-spellings';
import { linkedinKeywordFits } from '../channels/linkedin_keyword';
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
 * The LinkedIn job board's technology sets: the fewest sets, packed greedily in
 * the given (rank) order, whose keyword with `roles` stays within LinkedIn's
 * limits (`linkedinKeywordFits`). Each set takes the domain of its first
 * technology. A technology that can't fit even alone still gets a set of its
 * own: this step is pure and has no logger, so the collection tick warns when
 * such a segment's keyword is over the limit. Without role words nothing can
 * be measured, and every technology goes in one set.
 */
export function packLinkedinTechnologies(
  ranked: readonly { technology: string; domain: TechnologySet['domain'] }[],
  roles: readonly string[],
): TechnologySet[] {
  if (ranked.length === 0) return [];
  if (roles.length === 0)
    return [
      {
        technologies: ranked.map(({ technology }) => technology),
        domain: ranked[0].domain,
      },
    ];
  const fits = (technologies: string[]) =>
    linkedinKeywordFits(roles, technologies.flatMap(searchSpellings));
  const sets: TechnologySet[] = [];
  for (const { technology, domain } of ranked) {
    const last = sets.at(-1);
    if (last && fits([...last.technologies, technology]))
      last.technologies.push(technology);
    else sets.push({ technologies: [technology], domain });
  }
  return sets;
}

/**
 * The technology sets a channel searches. The LinkedIn job board packs every
 * top technology into the fewest sets whose keyword fits with the profile's
 * role words (`packLinkedinTechnologies`; one set for most profiles). Other
 * channels get each technology alone, under the domain of its best-ranked entry.
 */
export function technologySets(
  skills: RankedSkill[],
  channel: Channel,
  roles: readonly string[] = [],
): TechnologySet[] {
  const top = topSkills(skills);
  if (isLinkedinJobBoard(channel)) return packLinkedinTechnologies(top, roles);
  return top.map(({ technology, domain }) => ({
    technologies: [technology],
    domain,
  }));
}
