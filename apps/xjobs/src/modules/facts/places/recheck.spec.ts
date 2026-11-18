import { unmappedPlaces, type PlaceRow } from './recheck';
import type { PlaceVocabulary } from './resolver';

const vocab: PlaceVocabulary = {
  regions: new Set(['EU']),
  countries: new Set(['FR']),
  cities: new Map([['FR|paris', 'c-paris']]),
  countryNames: new Map(),
  cityCountries: new Map(),
  cityNames: new Map([['c-paris', 'Paris']]),
  regionCountries: new Map(),
};

const row = (p: Partial<PlaceRow>): PlaceRow => ({
  location: null,
  countryCode: null,
  regionCode: null,
  city: null,
  geoId: null,
  ...p,
});

describe('unmappedPlaces', () => {
  it('groups fallbacks by text and counts them', () => {
    const rueil = row({
      location: 'Rueil-Malmaison, Île-de-France, France',
      countryCode: 'FR',
      city: 'Rueil-Malmaison',
    });
    const rows = [
      rueil,
      rueil,
      row({ location: 'Paris, France', countryCode: 'FR', city: 'Paris' }),
      row({ regionCode: 'XYZ' }),
    ];
    expect(unmappedPlaces(rows, vocab)).toEqual([
      {
        text: 'Rueil-Malmaison, Île-de-France, France',
        result: 'country',
        count: 2,
      },
      { text: 'XYZ', result: 'none', count: 1 },
    ]);
  });
});
