import {
  LOCATION_ARRANGEMENTS,
  type LocationsByArrangement,
} from 'src/modules/queries';
import type { Place, PlaceLabels, PlacesByArrangement } from '../types';

export type { PlaceLabels } from '../types';

/** The text a place is searched by, from its label; throws naming a code that has no label. */
function placeText(place: Place, labels: PlaceLabels): string {
  const label = (map: Map<string, string>, code: string, kind: string) => {
    const text = map.get(code);
    if (text === undefined) throw new Error(`No label for ${kind} '${code}'`);
    return text;
  };
  switch (place.kind) {
    case 'worldwide':
      return 'Worldwide';
    case 'region':
      return label(labels.regions, place.code, 'region');
    case 'country':
      return label(labels.countries, place.code, 'country');
    case 'city': {
      const city = labels.cities.get(place.id);
      if (city === undefined)
        throw new Error(`No label for city '${place.id}'`);
      return `${city.name}, ${label(labels.countries, city.countryCode, 'country')}`;
    }
  }
}

/**
 * Per arrangement, the texts query search searches the places by: worldwide
 * as `Worldwide`, a region or country as its label, a city as
 * `<name>, <country label>`.
 */
export function placeTexts(
  places: PlacesByArrangement,
  labels: PlaceLabels,
): LocationsByArrangement {
  const texts = {} as LocationsByArrangement;
  for (const arrangement of LOCATION_ARRANGEMENTS)
    texts[arrangement] = places[arrangement].map((place) =>
      placeText(place, labels),
    );
  return texts;
}

/** Every place listed, whatever the arrangement: what to look labels up for. */
export function allPlaces(places: PlacesByArrangement): Place[] {
  return LOCATION_ARRANGEMENTS.flatMap((arrangement) => places[arrangement]);
}
