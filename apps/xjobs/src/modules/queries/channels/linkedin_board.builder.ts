import { Arrangement, Channel, Seniority } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  type ChannelQueryBuilder,
  technologyTerms,
  titleClause,
} from '../builders/channel.builder';
import { LINKEDIN_GEO_IDS } from './linkedin_geo';

/** LinkedIn `f_E` codes: 2 entry, 3 associate, 4 mid-senior. */
const EXPERIENCE_LEVELS: Record<Seniority, string | null> = {
  [Seniority.junior]: '2',
  [Seniority.mid]: '3',
  [Seniority.senior]: '4',
  [Seniority.staff]: '4',
  [Seniority.lead]: '4',
  [Seniority.principal]: '4',
  [Seniority.unstated]: null,
};

/** LinkedIn `f_WT` codes: 1 on-site, 2 remote, 3 hybrid. */
const WORK_TYPES: Record<Arrangement, string | null> = {
  [Arrangement.onsite]: '1',
  [Arrangement.remote]: '2',
  [Arrangement.hybrid]: '3',
  [Arrangement.unstated]: null,
};

/**
 * Title alternatives ANDed with the technologies; seniority, work type and
 * location go in LinkedIn's own filters, never in the keyword.
 */
export class LinkedinJobBoardBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;

  build(combination: QuerySearchCombination): ChannelQuery {
    const params: Record<string, unknown> = {};
    const experienceLevel = EXPERIENCE_LEVELS[combination.experience];
    if (experienceLevel !== null) params.experienceLevel = experienceLevel;
    const workType = WORK_TYPES[combination.type];
    if (workType !== null) params.workType = workType;
    params.location = combination.location;
    const geoId = LINKEDIN_GEO_IDS[combination.location];
    if (geoId) params.geoId = geoId;
    return {
      keyword: `${titleClause(combination.position)} AND ${technologyTerms(combination.technologies)}`,
      params,
    };
  }
}
