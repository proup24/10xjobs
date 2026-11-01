import { Channel } from 'src/common/enums';
import { mapLinkedinJob, mapLinkedinPost } from './linkedin';
import {
  type NormalizedRecord,
  type NormalizeResult,
  normalizedRecordSchema,
} from './record';
import { objectAt } from './text';

type Mapper = (
  payload: Record<string, unknown>,
) => NormalizedRecord | { invalid: string };

const mappers: Record<Channel, Mapper> = {
  [Channel.LINKEDIN_JOB_BOARD]: mapLinkedinJob,
  [Channel.LINKEDIN_POSTS]: mapLinkedinPost,
  [Channel.ASHBY]: () => ({ invalid: 'normalize: unsupported channel' }),
  [Channel.GREEN_HOUSE]: () => ({ invalid: 'normalize: unsupported channel' }),
};

/**
 * Maps one raw payload to the unified record. Pure and deterministic: no
 * network, no guessing; a fact the source does not state stays null.
 */
export function normalize(channel: Channel, payload: unknown): NormalizeResult {
  const mapped = mappers[channel](objectAt(payload));
  if ('invalid' in mapped) return mapped;
  const parsed = normalizedRecordSchema.safeParse(mapped);
  if (parsed.success) return { record: mapped };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.') || '(record)';
  return { invalid: `normalize: ${path}: ${issue?.message ?? 'invalid'}` };
}
