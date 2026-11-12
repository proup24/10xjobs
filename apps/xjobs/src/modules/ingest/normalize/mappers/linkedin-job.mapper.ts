import type { NormalizeContext } from '../normalize';
import type { NormalizedRecord } from '../record';
import { isHarvestJob, mapHarvestJob } from './harvest-job.mapper';
import { isBebityJob, mapBebityJob } from './bebity-job.mapper';
import {
  isCheapScraperJob,
  mapCheapScraperJob,
} from './cheap-scraper-job.mapper';

/** One LinkedIn job board actor's payload format. */
interface LinkedinJobFormat {
  actor: string;
  matches: (payload: Record<string, unknown>) => boolean;
  map: (
    payload: Record<string, unknown>,
    ctx: NormalizeContext,
  ) => NormalizedRecord;
}

/**
 * Every format raw storage may hold, current actor first. A raw item is
 * mapped by its own shape, so a renormalize reads old and new items alike. To
 * add an actor: write its mapper beside these and list it here first.
 */
const formats: readonly LinkedinJobFormat[] = [
  {
    actor: 'harvestapi/linkedin-job-search',
    matches: isHarvestJob,
    map: mapHarvestJob,
  },
  {
    actor: 'cheap_scraper/linkedin-job-scraper',
    matches: isCheapScraperJob,
    map: mapCheapScraperJob,
  },
  {
    actor: 'bebity/linkedin-jobs-scraper',
    matches: isBebityJob,
    map: mapBebityJob,
  },
];

/** A LinkedIn job board item, by the mapper of the actor whose shape it has. */
export function mapLinkedinJob(
  payload: Record<string, unknown>,
  ctx: NormalizeContext,
): NormalizedRecord | { invalid: string } {
  const format = formats.find(({ matches }) => matches(payload));
  return format
    ? format.map(payload, ctx)
    : { invalid: 'normalize: unknown LinkedIn job item format' };
}
