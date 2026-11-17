import type { FactOpening } from 'src/modules/facts/schema/facts';
import {
  countriesOf,
  intersects,
  type Overlap,
  type PlaceIndex,
} from './places';
import type { MatchEligibility } from './types';

/** Where the user lives: the residence country, then each residency authorization's place. Upper-cased, unique. */
export function homePlaces(eligibility: MatchEligibility): string[] {
  const codes = [
    eligibility.residenceCountry,
    ...eligibility.authorizations
      .filter((a) => a.kind === 'residency')
      .map((a) => a.place),
  ];
  const homes: string[] = [];
  for (const code of codes) {
    const upper = code?.toUpperCase();
    if (upper && !homes.includes(upper)) homes.push(upper);
  }
  return homes;
}

/** Whether the residence check is relevant to an opening; the caller checks for `remote`. */
export function residenceApplies(
  opening: FactOpening,
  homes: string[],
): boolean {
  return (
    opening.placesSource === 'description' &&
    (opening.placeStrictness === 'label' ||
      opening.placeStrictness === 'limit') &&
    opening.places.length > 0 &&
    homes.length > 0
  );
}

/** The countries a home code covers, or null when it is not a known region or country. */
function homeCountries(home: string, idx: PlaceIndex): Set<string> | null {
  const place = idx.countriesOfRegion.has(home)
    ? { kind: 'region' as const, code: home }
    : idx.countries.has(home)
      ? { kind: 'country' as const, code: home }
      : null;
  return place ? countriesOf(place, idx) : null;
}

/** Whether any home is inside any of the job's places: yes, maybe (could not place one), or no. */
export function livesIn(
  places: FactOpening['places'],
  homes: string[],
  idx: PlaceIndex,
): Overlap {
  const mine = homes.map((home) => homeCountries(home, idx));
  let result: Overlap = 'no';
  for (const place of places) {
    if (place.kind === 'worldwide') return 'yes';
    const job = countriesOf(place, idx);
    for (const countries of mine) {
      if (!job || !countries) result = 'maybe';
      else if (intersects(job, countries)) return 'yes';
    }
  }
  return result;
}
