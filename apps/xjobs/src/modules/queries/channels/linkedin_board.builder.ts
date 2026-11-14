import { Arrangement, Channel, Seniority } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import type { ChannelQueryBuilder } from '../builders/channel.builder';
import { roleWords } from '../builders/role-words';
import { searchSpellings } from '../builders/search-spellings';
import { linkedinKeyword } from './linkedin_keyword';
import { LINKEDIN_GEO_IDS } from './linkedin_geo';

/**
 * LinkedIn `f_E` codes, comma-joined when a seniority spans several:
 * 1 internship, 2 entry, 3 associate, 4 mid-senior, 5 director. Posters tag
 * loosely (most mid-level jobs say mid-senior), so each seniority takes its
 * neighbours too.
 */
const EXPERIENCE_LEVELS: Readonly<Record<string, string | null>> = {
  [Seniority.junior]: '1,2',
  [Seniority.mid]: '3,4',
  [Seniority.senior]: '4',
  [Seniority.staff]: '4,5',
  [Seniority.lead]: '4,5',
  [Seniority.principal]: '4,5',
  [Seniority.unstated]: null,
};

/** LinkedIn `f_WT` codes: 1 on-site, 2 remote, 3 hybrid. */
const WORK_TYPES: Record<Arrangement, string | null> = {
  [Arrangement.onsite]: '1',
  [Arrangement.remote]: '2',
  [Arrangement.hybrid]: '3',
  [Arrangement.unstated]: null,
};

/** The single LinkedIn `f_E` codes a seniority searches; none for an unstated one. */
export function linkedinLevels(seniority: string): string[] {
  return EXPERIENCE_LEVELS[seniority]?.split(',') ?? [];
}

/**
 * `(role words) AND (spellings)`: the position's role words in English and the
 * profile's languages, and every technology's spellings. Seniority, work type
 * and location go in LinkedIn's own filters, never in the keyword; the
 * processor judges fit.
 */
export class LinkedinJobBoardBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;

  build(combination: QuerySearchCombination): ChannelQuery {
    const roles = roleWords(combination.position, combination.languages);
    const spellings = [
      ...new Set(combination.technologies.flatMap(searchSpellings)),
    ].sort();
    const params: Record<string, unknown> = {};
    if (combination.experienceLevel !== undefined)
      params.experienceLevel = combination.experienceLevel;
    const workType = WORK_TYPES[combination.type];
    if (workType !== null) params.workType = workType;
    params.location = combination.location;
    const geoId = LINKEDIN_GEO_IDS[combination.location];
    if (geoId) params.geoId = geoId;
    params.roleWords = roles;
    params.spellings = spellings;
    return { keyword: linkedinKeyword(roles, spellings), params };
  }
}
