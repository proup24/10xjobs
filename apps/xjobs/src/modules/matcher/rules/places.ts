import type { Place as JobPlace } from 'src/modules/processor/schema';
import type { Place as ProfilePlace } from 'src/modules/users/types/place.types';

export interface PlaceIndex {
  /** region code -> its country codes (region_countries). */
  countriesOfRegion: Map<string, Set<string>>;
  /** city id -> country code (cities). */
  countryOfCity: Map<string, string>;
  /** Approved country codes (countries): a two-letter code outside it is not a sure country. */
  countries: Set<string>;
}

export type Overlap = 'yes' | 'maybe' | 'no';

/** The countries a place covers, or null when the index cannot say. */
export function countriesOf(
  place: JobPlace | ProfilePlace,
  idx: PlaceIndex,
): Set<string> | null {
  switch (place.kind) {
    case 'worldwide':
      return null;
    case 'country':
      return new Set([place.code]);
    case 'region': {
      const countries = idx.countriesOfRegion.get(place.code);
      return countries && countries.size > 0 ? countries : null;
    }
    case 'city': {
      const id = 'id' in place ? place.id : place.cityId;
      const country =
        (id ? idx.countryOfCity.get(id) : undefined) ??
        ('countryCode' in place ? place.countryCode : null);
      return country ? new Set([country]) : null;
    }
  }
}

/** Whether a place a job names overlaps a place a profile wants. */
export function overlaps(
  job: JobPlace,
  profile: ProfilePlace,
  idx: PlaceIndex,
): Overlap {
  if (job.kind === 'worldwide' || profile.kind === 'worldwide') return 'yes';

  if (job.kind === 'city' && profile.kind === 'city') {
    if (job.cityId !== null && job.cityId === profile.id) return 'yes';
    if (job.cityId === null) {
      const jobCountries = countriesOf(job, idx);
      const profileCountries = countriesOf(profile, idx);
      if (!jobCountries || !profileCountries) return 'maybe';
      return intersects(jobCountries, profileCountries) ? 'maybe' : 'no';
    }
    return 'no';
  }

  const jobCountries = countriesOf(job, idx);
  const profileCountries = countriesOf(profile, idx);
  // An unknown region or a city with no country: cannot say.
  if (!jobCountries || !profileCountries) return 'maybe';
  if (!intersects(jobCountries, profileCountries)) return 'no';
  return job.kind === 'city' && job.cityId === null ? 'maybe' : 'yes';
}

/** Whether two country sets share a country. */
export function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const c of a) if (b.has(c)) return true;
  return false;
}
