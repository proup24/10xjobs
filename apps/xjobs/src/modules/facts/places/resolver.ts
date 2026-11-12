import {
  LINKEDIN_REGION_CODES,
  LINKEDIN_REGION_GEO_IDS,
  WORLDWIDE,
} from '../config/linkedin-places';
import { foldPlaceName } from './fold';

export interface PlaceVocabulary {
  /** Approved region codes. */
  regions: Set<string>;
  /** Approved country codes. */
  countries: Set<string>;
  /** `${countryCode}|${foldPlaceName(name or alias)}` -> city id (approved and proposed). */
  cities: Map<string, string>;
  /** City id -> canonical city name. */
  cityNames: Map<string, string>;
  /** Region code -> its country codes (region_countries). */
  regionCountries: Map<string, Set<string>>;
}

export type ResolvedPlace =
  | { kind: 'worldwide' }
  | { kind: 'region'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'city'; name: string; countryCode: string; cityId: string };

export interface ListingLocation {
  countryCode: string | null;
  regionCode: string | null;
  city: string | null;
  geoId: string | null;
}

export interface ResolvedListingPlace {
  place: ResolvedPlace | null;
  /** True when the listing named something more specific than the place returned. */
  fellBack: boolean;
}

/** The `PlaceVocabulary.cities` key for a country and a place name or alias. */
export function cityKey(countryCode: string, name: string): string {
  return `${countryCode.toUpperCase()}|${foldPlaceName(name)}`;
}

/** The id of the city a country and name (or alias) point at, or null. */
export function findCity(
  name: string,
  countryCode: string,
  vocab: PlaceVocabulary,
): string | null {
  return vocab.cities.get(cityKey(countryCode, name)) ?? null;
}

/** Resolve a mapped region code: a place, or null when it is not an approved region. */
function regionPlace(
  mapped: string | undefined,
  vocab: PlaceVocabulary,
): ResolvedPlace | null {
  if (!mapped) return null;
  if (mapped === WORLDWIDE) return { kind: 'worldwide' };
  return vocab.regions.has(mapped) ? { kind: 'region', code: mapped } : null;
}

/** Where a LinkedIn listing is: region code, then region geoId, then city, then country. */
export function resolveListingPlace(
  loc: ListingLocation,
  vocab: PlaceVocabulary,
): ResolvedListingPlace {
  let named = false;

  const code = loc.regionCode?.trim().toUpperCase();
  if (code) {
    const place = regionPlace(LINKEDIN_REGION_CODES[code] ?? code, vocab);
    if (place) return { place, fellBack: false };
    named = true;
  }

  const geoId = loc.geoId?.trim();
  const country = loc.countryCode?.trim().toUpperCase();
  const city = loc.city?.trim();
  if (geoId) {
    const place = regionPlace(LINKEDIN_REGION_GEO_IDS[geoId], vocab);
    if (place) return { place, fellBack: false };
    // A city's own geoId is not a region; it is unresolved only when no
    // country or city is there to resolve instead.
    if (!country && !city) named = true;
  }

  if (country && vocab.countries.has(country)) {
    if (city) {
      const cityId = findCity(city, country, vocab);
      const name = cityId ? vocab.cityNames.get(cityId) : undefined;
      if (cityId && name) {
        return {
          place: { kind: 'city', name, countryCode: country, cityId },
          fellBack: named,
        };
      }
      return { place: { kind: 'country', code: country }, fellBack: true };
    }
    return { place: { kind: 'country', code: country }, fellBack: named };
  }

  return { place: null, fellBack: named || !!country || !!city };
}
