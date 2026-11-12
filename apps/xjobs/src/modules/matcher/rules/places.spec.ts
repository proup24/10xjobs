import { overlaps, type PlaceIndex } from './places';
import { CITY_A, CITY_B } from './fixtures.testing';

const idx: PlaceIndex = {
  countriesOfRegion: new Map([
    ['EU', new Set(['FR', 'DE'])],
    ['EMEA', new Set(['FR', 'DE', 'MA'])],
    ['NORTH_AMERICA', new Set(['US', 'CA'])],
  ]),
  countryOfCity: new Map([
    [CITY_A, 'MA'],
    [CITY_B, 'FR'],
  ]),
  countries: new Set(['MA', 'FR']),
};

describe('overlaps', () => {
  it('worldwide overlaps anything, from either side', () => {
    expect(
      overlaps({ kind: 'worldwide' }, { kind: 'country', code: 'US' }, idx),
    ).toBe('yes');
    expect(
      overlaps({ kind: 'country', code: 'US' }, { kind: 'worldwide' }, idx),
    ).toBe('yes');
  });
  it('regions share countries', () => {
    expect(
      overlaps(
        { kind: 'region', code: 'EU' },
        { kind: 'region', code: 'EMEA' },
        idx,
      ),
    ).toBe('yes');
    expect(
      overlaps(
        { kind: 'region', code: 'EU' },
        { kind: 'region', code: 'NORTH_AMERICA' },
        idx,
      ),
    ).toBe('no');
  });
  it('a country sits inside a region', () => {
    expect(
      overlaps(
        { kind: 'country', code: 'FR' },
        { kind: 'region', code: 'EU' },
        idx,
      ),
    ).toBe('yes');
  });
  it('a known city sits inside its country', () => {
    expect(
      overlaps(
        { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: CITY_B },
        { kind: 'country', code: 'FR' },
        idx,
      ),
    ).toBe('yes');
  });
  it('a city without an id is only maybe', () => {
    expect(
      overlaps(
        { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: null },
        { kind: 'country', code: 'FR' },
        idx,
      ),
    ).toBe('maybe');
    expect(
      overlaps(
        { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: null },
        { kind: 'city', id: CITY_B },
        idx,
      ),
    ).toBe('maybe');
    expect(
      overlaps(
        { kind: 'city', name: 'Paris', countryCode: null, cityId: null },
        { kind: 'country', code: 'US' },
        idx,
      ),
    ).toBe('maybe');
  });
  it('different cities do not overlap; the same city does', () => {
    const a = {
      kind: 'city' as const,
      name: 'A',
      countryCode: 'MA',
      cityId: CITY_A,
    };
    expect(overlaps(a, { kind: 'city', id: CITY_B }, idx)).toBe('no');
    expect(overlaps(a, { kind: 'city', id: CITY_A }, idx)).toBe('yes');
  });
  it('an unknown region code is maybe', () => {
    expect(
      overlaps(
        { kind: 'region', code: 'MARS' },
        { kind: 'country', code: 'FR' },
        idx,
      ),
    ).toBe('maybe');
  });
});
