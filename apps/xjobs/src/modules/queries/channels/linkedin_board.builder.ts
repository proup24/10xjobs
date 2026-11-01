import { Arrangement, Channel, Region, Seniority } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  type ChannelQueryBuilder,
  technologyTerms,
  titleClause,
} from '../builders/channel.builder';
import { LINKEDIN_REGIONS, linkedinPlace } from './linkedin_geo';

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
 * place go in LinkedIn's own filters, never in the keyword.
 */
export class LinkedinJobBoardBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;

  build(combination: QuerySearchCombination): ChannelQuery {
    const params: Record<string, unknown> = {};
    const experienceLevel = EXPERIENCE_LEVELS[combination.experience];
    if (experienceLevel !== null) params.experienceLevel = experienceLevel;
    const workType = WORK_TYPES[combination.type];
    if (workType !== null) params.workType = workType;
    const placeBound =
      combination.type === Arrangement.onsite ||
      combination.type === Arrangement.hybrid;
    if (placeBound && combination.country) {
      const place = linkedinPlace(combination.country, combination.city);
      params.location = place.location;
      if (place.geoId) params.geoId = place.geoId;
    } else {
      const region =
        LINKEDIN_REGIONS[combination.locationRegion ?? Region.GLOBAL];
      params.location = region.location;
      if (region.geoId) params.geoId = region.geoId;
    }
    return {
      keyword: `${titleClause(combination.position)} AND ${technologyTerms(combination.technologies)}`,
      params,
    };
  }
}
