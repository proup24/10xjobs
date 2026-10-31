import { Arrangement, Channel, Seniority } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  keywordPhrase,
  locationText,
  type ChannelQueryBuilder,
} from '../builders/channel.builder';

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

export class LinkedinJobBoardBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;

  build(combination: QuerySearchCombination): ChannelQuery {
    const params: Record<string, unknown> = {
      location: locationText(combination),
    };
    const experienceLevel = EXPERIENCE_LEVELS[combination.experience];
    if (experienceLevel !== null) params.experienceLevel = experienceLevel;
    const workType = WORK_TYPES[combination.type];
    if (workType !== null) params.workType = workType;
    return { keyword: keywordPhrase(combination), params };
  }
}
