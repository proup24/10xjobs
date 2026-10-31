import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { channelConfig } from '../../config';
import type { CollectorSearch, CollectedJob } from '../../types/collector';
import {
  contact,
  plainText,
  precisionOf,
  record,
  text,
} from '../../utils/collected-job';
import { ApifyActorProvider } from './apify.provider';

@Injectable()
export class LinkedinJobSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(search: CollectorSearch): Promise<CollectedJob[]> {
    const cfg = channelConfig[Channel.LINKEDIN_JOB_BOARD];
    const url = linkedinJobSearchUrl(search.keyword, search.params);
    const location = linkedinLocation(search.params.location);
    const label = location
      ? `${search.keyword} in ${location}`
      : search.keyword;
    const items = await this.actor.run(
      cfg.actor,
      { startUrls: [{ url }], maxRowsPerUrl: cfg.discovery.maxRowsPerUrl },
      { maxChargeUsd: cfg.maximumOperationBudgetMicroUsd / 1_000_000 },
    );
    return items.map((item) => toJob(record(item), label));
  }
}

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/**
 * The job search URL for one builder: its keyword, location, and the
 * `f_E` (experience) and `f_WT` (work type) filters when the builder has them.
 */
export function linkedinJobSearchUrl(
  keyword: string,
  params: Record<string, unknown>,
): string {
  const query = new URLSearchParams({ keywords: keyword });
  const location = linkedinLocation(params.location);
  if (location) query.set('location', location);
  if (typeof params.experienceLevel === 'string')
    query.set('f_E', params.experienceLevel);
  if (typeof params.workType === 'string') query.set('f_WT', params.workType);
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

function toJob(item: Record<string, unknown>, search: string): CollectedJob {
  const postedAt = text(item.publishedAt) ?? text(item.postedAt);
  return {
    source: 'linkedin-jobs',
    sourceJobId: text(item.id) ?? text(item.jobId) ?? '',
    url: text(item.url) ?? text(item.link) ?? text(item.jobUrl) ?? '',
    applyUrl: text(item.applyUrl),
    title: text(item.title) ?? '',
    company: text(item.companyName) ?? text(item.company) ?? '',
    location: text(item.location),
    postedAt,
    postedAtPrecision: precisionOf(postedAt),
    description: plainText(
      text(item.descriptionHtml) ?? text(item.description) ?? '',
    ),
    contact: contact(item.posterFullName, item.posterProfileUrl),
    search,
    raw: item,
  };
}
