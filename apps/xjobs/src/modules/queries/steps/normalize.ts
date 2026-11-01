import { Arrangement, Region } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';

/** Where remote searches go when the profile names no region. */
export const DEFAULT_REMOTE_REGION = Region.GLOBAL;

/** One spelling per city: inner whitespace collapsed, each word (and hyphenated part) title-cased. */
export function canonicalCity(city: string | null | undefined): string | null {
  const collapsed = city?.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  return collapsed
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_match, separator: string, letter: string) =>
        separator + letter.toUpperCase(),
    );
}

/** Formatting differences must not create duplicate permanent builders. */
export function normalizeProfile(
  input: QuerySearchProfileInput,
): QuerySearchProfileInput {
  const regions = [...new Set(input.regions)];
  return {
    ...input,
    country: input.country.trim().toUpperCase(),
    city: canonicalCity(input.city),
    regions: regions.length > 0 ? regions : [DEFAULT_REMOTE_REGION],
  };
}

/** `unstated` is always searched as remote; an empty list means remote. Deduped, first-seen order. */
export function normalizeArrangements(
  arrangements: Arrangement[],
): Arrangement[] {
  const mapped = arrangements.map((arrangement) =>
    arrangement === Arrangement.unstated ? Arrangement.remote : arrangement,
  );
  return mapped.length > 0 ? [...new Set(mapped)] : [Arrangement.remote];
}
