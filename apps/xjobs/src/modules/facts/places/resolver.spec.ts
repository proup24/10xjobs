import { foldPlaceName } from './fold';
import {
  findCity,
  resolveListingPlace,
  type ListingLocation,
  type PlaceVocabulary,
} from './resolver';

const vocab: PlaceVocabulary = {
  regions: new Set(['EU', 'EEA', 'EMEA', 'NORTH_AMERICA']),
  countries: new Set(['FR', 'MA']),
  cities: new Map([
    ['FR|paris', 'c-paris'],
    ['MA|fes', 'c-fes'],
    ['MA|fez', 'c-fes'],
  ]),
  cityNames: new Map([
    ['c-paris', 'Paris'],
    ['c-fes', 'Fès'],
  ]),
  regionCountries: new Map(),
};

const loc = (p: Partial<ListingLocation>): ListingLocation => ({
  countryCode: null,
  regionCode: null,
  city: null,
  geoId: null,
  ...p,
});

describe('foldPlaceName', () => {
  it('drops accents, lower-cases and joins hyphens', () => {
    expect(foldPlaceName('Vélizy-Villacoublay')).toBe('velizy villacoublay');
  });
});

describe('resolveListingPlace', () => {
  it('maps a LinkedIn region code', () => {
    expect(resolveListingPlace(loc({ regionCode: 'NAMER' }), vocab)).toEqual({
      place: { kind: 'region', code: 'NORTH_AMERICA' },
      fellBack: false,
    });
  });
  it('gives null for an unknown region code', () => {
    expect(resolveListingPlace(loc({ regionCode: 'XYZ' }), vocab)).toEqual({
      place: null,
      fellBack: true,
    });
  });
  it('maps a region geoId', () => {
    expect(resolveListingPlace(loc({ geoId: '91000002' }), vocab)).toEqual({
      place: { kind: 'region', code: 'EEA' },
      fellBack: false,
    });
  });
  it('maps the worldwide geoId', () => {
    expect(resolveListingPlace(loc({ geoId: '92000000' }), vocab)).toEqual({
      place: { kind: 'worldwide' },
      fellBack: false,
    });
  });
  it('skips a mapped region that is not approved', () => {
    expect(resolveListingPlace(loc({ geoId: '91000011' }), vocab)).toEqual({
      place: null,
      fellBack: true,
    });
  });
  it('finds a city in the vocabulary', () => {
    expect(
      resolveListingPlace(loc({ countryCode: 'FR', city: 'Paris' }), vocab),
    ).toEqual({
      place: {
        kind: 'city',
        name: 'Paris',
        countryCode: 'FR',
        cityId: 'c-paris',
      },
      fellBack: false,
    });
  });
  it('falls back to the country for an unknown city', () => {
    expect(
      resolveListingPlace(
        loc({ countryCode: 'FR', city: 'Rueil-Malmaison' }),
        vocab,
      ),
    ).toEqual({ place: { kind: 'country', code: 'FR' }, fellBack: true });
  });
  it('matches an alias and returns the canonical name', () => {
    const r = resolveListingPlace(
      loc({ countryCode: 'MA', city: 'Fez' }),
      vocab,
    );
    expect(r.place).toMatchObject({ kind: 'city', name: 'Fès' });
    expect(r.fellBack).toBe(false);
  });
  it('folds accents', () => {
    const r = resolveListingPlace(
      loc({ countryCode: 'ma', city: 'Fes' }),
      vocab,
    );
    expect(r.place).toMatchObject({ kind: 'city', name: 'Fès' });
    expect(r.fellBack).toBe(false);
  });
  it('gives the country when no city is named', () => {
    expect(resolveListingPlace(loc({ countryCode: 'MA' }), vocab)).toEqual({
      place: { kind: 'country', code: 'MA' },
      fellBack: false,
    });
  });
  it('gives null for an unapproved country', () => {
    expect(resolveListingPlace(loc({ countryCode: 'ZZ' }), vocab)).toEqual({
      place: null,
      fellBack: true,
    });
  });
});

describe('findCity', () => {
  it('returns null when absent', () => {
    expect(findCity('Lyon', 'FR', vocab)).toBeNull();
  });
});
