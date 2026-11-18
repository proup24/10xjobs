import { foldPlaceName } from './fold';
import { parseLocationText, US_STATE_CODES } from './location-text';
import type { PlaceVocabulary } from './resolver';

const countryNames = new Map(
  [
    ['Morocco', 'MA'],
    ['France', 'FR'],
    ['Austria', 'AT'],
    ['Netherlands', 'NL'],
    ['United States', 'US'],
    ['Canada', 'CA'],
  ].map(([n, c]) => [foldPlaceName(n), c]),
);
const cityCountries = new Map(
  (
    [
      ['Casablanca', ['MA']],
      ['Amsterdam', ['NL']],
      ['Agadir', ['MA']],
      ['Austin', ['US']],
      ['London', ['GB', 'CA']],
    ] as [string, string[]][]
  ).map(([n, c]) => [foldPlaceName(n), new Set(c)]),
);
const vocab: PlaceVocabulary = {
  regions: new Set(),
  countries: new Set(countryNames.values()),
  cities: new Map(),
  cityNames: new Map(),
  regionCountries: new Map(),
  countryNames,
  cityCountries,
};

describe('parseLocationText', () => {
  it.each([
    ['Casablanca, Casablanca-Settat, Morocco', 'MA', 'Casablanca', true],
    ['Rabat, Rabat-Salé-Kénitra, Morocco', 'MA', 'Rabat', true],
    ['Île-de-France, France', 'FR', null, true],
    ['Austria', 'AT', null, true],
    ['Amsterdam Area', 'NL', 'Amsterdam', true],
    ['Greater Amsterdam Area', 'NL', 'Amsterdam', true],
    ['Agadir Metropolitan Area', 'MA', 'Agadir', true],
    ['London', null, null, true],
    ['Austin, TX', 'US', 'Austin', true],
    ['Springfield, ZZ', null, null, true],
    ['Atlantis, Lemuria', null, null, true],
    ['', null, null, false],
    ['  ', null, null, false],
  ])('%j', (text, countryCode, city, named) => {
    expect(parseLocationText(text, vocab)).toEqual({
      countryCode,
      city,
      named,
    });
  });

  it('knows the 50 states and DC', () => {
    expect(US_STATE_CODES.size).toBe(51);
    expect(US_STATE_CODES.has('DC')).toBe(true);
  });
});
