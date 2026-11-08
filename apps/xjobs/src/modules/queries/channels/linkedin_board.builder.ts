import { Arrangement, Channel, Seniority } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import type { ChannelQueryBuilder } from '../builders/channel.builder';
import { TECHNOLOGY_TERMS } from '../builders/keywords';
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

/**
 * Short spellings for LinkedIn's keyword search, which matches loose words and
 * drops symbols: `next js`, not `"next.js"`. Technologies not listed use
 * {@link TECHNOLOGY_TERMS}; `golang` stays, a bare `go` matching everything.
 */
export const LINKEDIN_TERMS: Readonly<Record<string, string>> = {
  nodejs: 'node js',
  nextjs: 'next js',
  vue: 'vue js',
  express: 'express js',
  spring: 'spring',
  spark: 'spark',
  tailwindcss: 'tailwind',
  rails: 'rails',
  dotnet: 'dotnet',
  csharp: 'csharp',
  cpp: 'cpp',
};

/** The technology as LinkedIn posters write it. */
export function linkedinTerm(technology: string): string {
  return LINKEDIN_TERMS[technology] ?? TECHNOLOGY_TERMS[technology];
}

/**
 * A plain keyword, the position's main title then the technologies
 * (`backend engineer golang`): no quotes or operators, so LinkedIn matches
 * loosely and the processor judges fit. Seniority, work type and location go
 * in LinkedIn's own filters, never in the keyword.
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
    const keyword = combination.technologies.map(linkedinTerm).join(' ');
    return { keyword, params };
  }
}
