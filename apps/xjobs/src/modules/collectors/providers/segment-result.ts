import type {
  ItemOrigin,
  RawCollectedItem,
  SegmentResult,
} from '../types/collector';
import { attribute } from '../utils/collected-job';

/**
 * Attributes one actor run's items to the segment members by the origins its
 * mapper read, and flags each member that returned `rowLimit` items or more
 * as truncated. `origins[i]` is where `items[i]` came from. Items matching no
 * member are kept as `unattributed`.
 */
export function attributeItems(
  items: readonly unknown[],
  origins: readonly ItemOrigin[],
  searches: readonly { id: string; search: string }[],
  rowLimit: number,
): Pick<
  SegmentResult,
  'itemsByQuery' | 'unattributed' | 'truncatedQueryIds' | 'fetched'
> {
  const found = items.map((payload, i) => ({
    raw: { rank: origins[i]?.rank ?? null, payload } as RawCollectedItem,
    search: origins[i]?.search ?? null,
  }));
  const { byQuery, unattributed } = attribute(
    found,
    ({ search }) => search,
    searches,
  );
  const itemsByQuery = new Map<string, RawCollectedItem[]>();
  const truncatedQueryIds: string[] = [];
  for (const { id } of searches) {
    const own = (byQuery.get(id) ?? []).map(({ raw }) => raw);
    itemsByQuery.set(id, own);
    if (own.length >= rowLimit) truncatedQueryIds.push(id);
  }
  return {
    itemsByQuery,
    unattributed: unattributed.map(({ raw }) => raw),
    truncatedQueryIds,
    fetched: items.length,
  };
}
