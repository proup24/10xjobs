import { convert } from 'html-to-text';
import type { CollectedJob } from '../types/collector';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Trimmed string, or null when the value is not a non-blank string or number. */
export function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Converts source markup to plain text. Plain text passes through unchanged.
 * `entityEncoded` decodes an extra entity layer first (Greenhouse wraps its HTML this way).
 */
export function plainText(body: string, entityEncoded = false): string {
  let value = body;
  if (entityEncoded && /&lt;\/?[a-z][\s\S]*?&gt;/i.test(value)) {
    value = convert(value, { wordwrap: false });
  }
  return /<\/?[a-z][^>]*>/i.test(value)
    ? convert(value, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      }).trim()
    : value.trim();
}

/** A contact needs both a name and a profile URL; anything less is no contact. */
export function contact(name: unknown, url: unknown): CollectedJob['contact'] {
  const contactName = text(name);
  const contactUrl = text(url);
  return contactName && contactUrl
    ? { name: contactName, url: contactUrl }
    : null;
}

/** Date-only values carry day precision; timestamps carry hour precision. */
export function precisionOf(postedAt: string | null): 'hour' | 'day' {
  return postedAt?.includes('T') ? 'hour' : 'day';
}

/** Share of the charge cap from which a run counts as stopped by it (career-hub). */
const CHARGE_CAP_RATIO = 0.95;

/** Whether a run that charged `costUsd` stopped at its `maxChargeUsd` cap. */
export function reachedChargeCap(
  costUsd: number | null,
  maxChargeUsd: number,
): boolean {
  return costUsd !== null && costUsd >= maxChargeUsd * CHARGE_CAP_RATIO;
}

/**
 * Attributes items to the segment members whose search found them: `searchOf`
 * reads the search an item echoes (input URL, query), `searches` maps each
 * member to its search. Items matching no member are dropped. Every member id
 * is a key of the result.
 */
export function attribute<T>(
  items: readonly T[],
  searchOf: (item: T) => string | null,
  searches: readonly { id: string; search: string }[],
): Map<string, T[]> {
  const byQuery = new Map<string, T[]>(searches.map(({ id }) => [id, []]));
  const idsBySearch = new Map<string, string[]>();
  for (const { id, search } of searches)
    idsBySearch.set(search, [...(idsBySearch.get(search) ?? []), id]);
  for (const item of items) {
    const search = searchOf(item);
    for (const id of (search && idsBySearch.get(search)) || [])
      byQuery.get(id)?.push(item);
  }
  return byQuery;
}

/**
 * Maps every distinct key with at most `limit` calls in flight. A call that
 * fails leaves its key out of the result, so one bad item never fails the rest.
 */
export async function settledByKey<T>(
  keys: readonly string[],
  limit: number,
  map: (key: string) => Promise<T>,
): Promise<{ values: Map<string, T>; failed: Map<string, unknown> }> {
  const pending = [...new Set(keys)];
  const values = new Map<string, T>();
  const failed = new Map<string, unknown>();
  const worker = async () => {
    for (let key = pending.shift(); key !== undefined; key = pending.shift()) {
      try {
        values.set(key, await map(key));
      } catch (error) {
        failed.set(key, error);
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { values, failed };
}
