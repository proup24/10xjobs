import { resolveListingPlace, type PlaceVocabulary } from './resolver';

export interface PlaceRow {
  location: string | null;
  countryCode: string | null;
  regionCode: string | null;
  city: string | null;
  geoId: string | null;
}

export interface UnmappedPlace {
  text: string;
  result: 'country' | 'none';
  count: number;
}

/** The row's location text, or the parts LinkedIn gave when it has none. */
function placeText(row: PlaceRow): string {
  if (row.location?.trim()) return row.location.trim();
  const parts = [row.city, row.regionCode, row.countryCode, row.geoId]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  return parts.join(', ');
}

/**
 * Rows whose place fell back to a country or to nothing, grouped by text and
 * counted, most common first. Rows that resolve without falling back are left
 * out.
 */
export function unmappedPlaces(
  rows: PlaceRow[],
  vocab: PlaceVocabulary,
): UnmappedPlace[] {
  const groups = new Map<string, UnmappedPlace>();
  for (const row of rows) {
    const { place, fellBack } = resolveListingPlace(row, vocab);
    if (!fellBack) continue;
    const result = place?.kind === 'country' ? 'country' : 'none';
    const text = placeText(row);
    const key = `${result}\u0000${text}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { text, result, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text),
  );
}
