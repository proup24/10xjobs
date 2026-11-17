import type { ResolvedPlace } from '../places/resolver';
import type { FactOpening, FactWorkAuthorization } from '../schema/facts';

type PlaceLike = FactOpening['places'][number] | ResolvedPlace;

/** The code a place stands for, upper-cased; `null` for a city with no country. */
function placeCode(place: PlaceLike): string | null {
  if (place.kind === 'worldwide') return null;
  const code = place.kind === 'city' ? place.countryCode : place.code;
  return code ? code.toUpperCase() : null;
}

/**
 * A job that offers no sponsorship and states no requirement still needs a work permit where
 * it is: derive `work-permit` requirements from the description's places (those that are not
 * mere mentions), else from the LinkedIn place. Worldwide, or no place, derives nothing.
 */
export function deriveFromNoSponsorship(
  value: FactWorkAuthorization | null,
  described: FactOpening[],
  listingPlace: ResolvedPlace | null,
): FactWorkAuthorization | null {
  if (!value || value.sponsorship !== 'no' || value.requirements.length > 0)
    return value;
  const inDescription = described
    .filter((o) => o.placeStrictness !== 'mention')
    .flatMap((o) => o.places);
  const worldwide = inDescription.some((p) => p.kind === 'worldwide');
  const fromDescription = inDescription.flatMap((p) => placeCode(p) ?? []);
  let codes: string[];
  if (worldwide) codes = [];
  else if (fromDescription.length > 0) codes = fromDescription;
  else {
    const code = listingPlace ? placeCode(listingPlace) : null;
    codes = code ? [code] : [];
  }
  const places = [...new Set(codes)];
  if (places.length === 0) return value;
  return {
    ...value,
    requirements: places.map((place) => ({
      kind: 'work-permit' as const,
      place,
      derived: 'no-sponsorship' as const,
    })),
  };
}
