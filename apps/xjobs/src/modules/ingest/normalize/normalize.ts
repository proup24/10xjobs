import { Channel } from 'src/common/enums';
import { mapAshby, mapGreenhouse } from './ats';
import { mapLinkedinJob } from './mappers/linkedin-job.mapper';
import {
  type NormalizedRecord,
  type NormalizeResult,
  normalizedRecordSchema,
} from './record';
import { objectAt } from './text';

/** What a mapper may need besides the payload. */
export interface NormalizeContext {
  /** When the payload was scraped: the base of a relative "N ago" text. */
  scrapedAt: Date;
}

type Mapper = (
  payload: Record<string, unknown>,
  ctx: NormalizeContext,
) => NormalizedRecord | { invalid: string };

const mappers: Partial<Record<Channel, Mapper>> = {
  [Channel.LINKEDIN_JOB_BOARD]: mapLinkedinJob,
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: mapLinkedinJob,
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: mapLinkedinJob,
  [Channel.ASHBY]: mapAshby,
  [Channel.GREEN_HOUSE]: mapGreenhouse,
};

/**
 * Maps one raw payload to the unified record. Pure and deterministic: no
 * network, no guessing; a fact the source does not state stays null.
 */
export function normalize(
  channel: Channel,
  payload: unknown,
  ctx: NormalizeContext,
): NormalizeResult {
  const mapper = mappers[channel];
  if (!mapper) return { invalid: `normalize: ${channel} is not normalized` };
  const mapped = mapper(objectAt(payload), ctx);
  if ('invalid' in mapped) return mapped;
  const parsed = normalizedRecordSchema.safeParse(mapped);
  if (parsed.success) return { record: mapped };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.') || '(record)';
  return { invalid: `normalize: ${path}: ${issue?.message ?? 'invalid'}` };
}
