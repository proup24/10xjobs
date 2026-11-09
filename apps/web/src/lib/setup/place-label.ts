import type { PickerOption } from '@/components/ui/picker';
import type { Place } from './answers';

/** Shown for a code missing from its list: codes are never shown raw. */
export const UNKNOWN = 'Unknown';

/** A label lookup over a value list. */
export function labeller(options: readonly PickerOption[]) {
  const byValue = new Map(options.map((o) => [o.value, o.label]));
  return (code: string) => byValue.get(code) ?? UNKNOWN;
}

/** The label of a place, from the region, country and city lists. */
export function placeLabeler(lists: {
  regions: readonly PickerOption[];
  countries: readonly PickerOption[];
  cities: readonly PickerOption[];
}): (place: Place) => string {
  const region = labeller(lists.regions);
  const country = labeller(lists.countries);
  const city = labeller(
    lists.cities.map((c) => ({ ...c, value: c.value.toLowerCase() })),
  );
  return (place) => {
    switch (place.kind) {
      case 'worldwide':
        return 'Worldwide';
      case 'region':
        return region(place.code);
      case 'country':
        return country(place.code);
      case 'city':
        return city(place.id.toLowerCase());
    }
  };
}
