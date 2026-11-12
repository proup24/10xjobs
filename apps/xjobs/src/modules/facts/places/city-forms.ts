import { foldPlaceName } from './fold';

/** The columns of a city row that decide which city a spelling means. */
export interface CityFormRow {
  id: string;
  name: string;
  aliases: readonly string[];
  countryCode: string;
  status: string;
  firstSeenAt: Date;
}

/** The `PlaceVocabulary.cities` key for a country and a place name or alias. */
export function placeCityKey(countryCode: string, name: string): string {
  return `${countryCode.toUpperCase()}|${foldPlaceName(name)}`;
}

/**
 * Folded spelling -> city id, keyed by `placeCityKey`. When cities share a
 * spelling the winner is, in order: a canonical name over an alias, an approved
 * city over a proposed one, the oldest first seen, then the lowest id. The
 * resolver's vocabulary and `upsertCities` both build their map here, so they
 * always agree on which city a spelling means.
 */
export function cityForms(rows: readonly CityFormRow[]): Map<string, string> {
  interface Candidate {
    key: string;
    id: string;
    isName: boolean;
    approved: boolean;
    seen: number;
  }
  const candidates: Candidate[] = [];
  for (const r of rows) {
    const spellings = [
      { n: r.name, isName: true },
      ...r.aliases.map((n) => ({ n, isName: false })),
    ];
    for (const { n, isName } of spellings) {
      if (foldPlaceName(n) === '') continue;
      candidates.push({
        key: placeCityKey(r.countryCode, n),
        id: r.id,
        isName,
        approved: r.status === 'approved',
        seen: r.firstSeenAt.getTime(),
      });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.isName) - Number(a.isName) ||
      Number(b.approved) - Number(a.approved) ||
      a.seen - b.seen ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const forms = new Map<string, string>();
  for (const c of candidates) if (!forms.has(c.key)) forms.set(c.key, c.id);
  return forms;
}
