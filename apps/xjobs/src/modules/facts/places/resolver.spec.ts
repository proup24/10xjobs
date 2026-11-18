import { SEED_CITIES } from '@xjobs/database';
import { cityForms } from './city-forms';
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
  countryNames: new Map([
    ['france', 'FR'],
    ['austria', 'AT'],
    ['morocco', 'MA'],
  ]),
  cityCountries: new Map([['casablanca', new Set(['MA'])]]),
};

const vocab2: PlaceVocabulary = {
  ...vocab,
  cities: new Map([['MA|casablanca', 'c-casa']]),
  cityNames: new Map([['c-casa', 'Casablanca']]),
};

const loc = (p: Partial<ListingLocation>): ListingLocation => ({
  countryCode: null,
  regionCode: null,
  city: null,
  geoId: null,
  location: null,
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
  it('resolves a place from location text when no structured field is set', () => {
    const r = resolveListingPlace(
      loc({ location: 'Casablanca, Casablanca-Settat, Morocco' }),
      vocab2,
    );
    expect(r.fellBack).toBe(false);
    expect(r.place?.kind).toBe('city');
  });
  it('gives no place and fellBack for unreadable location text', () => {
    expect(
      resolveListingPlace(loc({ location: 'Atlantis, Lemuria' }), vocab2),
    ).toEqual({ place: null, fellBack: true });
  });
  it('ignores location text when a structured field is set', () => {
    expect(
      resolveListingPlace(
        loc({ countryCode: 'FR', location: 'Austria' }),
        vocab2,
      ),
    ).toEqual({ place: { kind: 'country', code: 'FR' }, fellBack: false });
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

describe('resolveListingPlace against the seeded Moroccan cities', () => {
  const rows = SEED_CITIES.map((c, i) => ({
    id: `seed-${i}`,
    name: c.name,
    aliases: c.aliases,
    countryCode: c.countryCode,
    status: 'approved' as const,
    firstSeenAt: new Date(2026, 0, 1),
  }));
  const seeded = (omitAlias?: string): PlaceVocabulary => {
    const used = rows.map((r) => ({
      ...r,
      aliases: r.aliases.filter((a) => a !== omitAlias),
    }));
    return {
      regions: new Set(['NORTH_AMERICA']),
      countries: new Set(['MA']),
      cities: cityForms(used),
      cityNames: new Map(used.map((r) => [r.id, r.name])),
      regionCountries: new Map(),
      countryNames: new Map(),
      cityCountries: new Map(),
    };
  };
  const cityOf = (city: string) => {
    const r = resolveListingPlace(loc({ countryCode: 'MA', city }), seeded());
    return r.place?.kind === 'city' ? r.place.name : r;
  };

  it.each([
    ['Mechouar', 'Casablanca'],
    ['Prefecture of Casablanca', 'Casablanca'],
    ['Fez', 'Fès'],
    ['Marrakesh', 'Marrakech'],
    ['Salé El Jadida', 'Salé'],
    ['Tanger', 'Tangier'],
  ])('resolves %s to %s', (city, name) => {
    expect(cityOf(city)).toBe(name);
  });

  it('keeps a state-only Casablanca-Settat as the country', () => {
    expect(
      resolveListingPlace(loc({ countryCode: 'MA', city: null }), seeded()),
    ).toEqual({ place: { kind: 'country', code: 'MA' }, fellBack: false });
  });

  it('falls back to the country for a city the vocabulary lacks', () => {
    expect(
      resolveListingPlace(
        loc({ countryCode: 'MA', city: 'Mechouar' }),
        seeded('Mechouar'),
      ),
    ).toEqual({ place: { kind: 'country', code: 'MA' }, fellBack: true });
  });

  it('maps the NAMER geoId to North America', () => {
    expect(resolveListingPlace(loc({ geoId: '91000022' }), seeded())).toEqual({
      place: { kind: 'region', code: 'NORTH_AMERICA' },
      fellBack: false,
    });
  });
});
