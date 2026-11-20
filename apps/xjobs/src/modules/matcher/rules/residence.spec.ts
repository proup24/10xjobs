import type { FactOpening as Opening } from 'src/modules/facts/schema/facts';
import type { PlaceIndex } from './places';
import { homePlaces, livesIn, residenceApplies } from './residence';

const idx: PlaceIndex = {
  countriesOfRegion: new Map([
    ['EU', new Set(['FR', 'DE'])],
    ['EUROPE', new Set(['FR', 'DE', 'GB'])],
    ['EMEA', new Set(['FR', 'DE', 'GB', 'MA'])],
  ]),
  countryOfCity: new Map(),
  countries: new Set(['MA', 'FR', 'DE', 'GB', 'US', 'CA']),
};
const country = (code: string) => ({ kind: 'country' as const, code });
const region = (code: string) => ({ kind: 'region' as const, code });
const berlin = {
  kind: 'city' as const,
  name: 'Berlin',
  countryCode: 'DE',
  cityId: null,
};
const opening = (edit: Partial<Opening>): Opening => ({
  arrangements: ['remote'],
  places: [],
  placeStrictness: 'unstated',
  timezones: [],
  quote: '',
  confidence: 'sure',
  arrangementSource: 'description',
  placesSource: 'description',
  ...edit,
});

describe('homePlaces', () => {
  it('takes residence first, then residency authorizations only', () => {
    expect(
      homePlaces({
        residenceCountry: 'ma',
        authorizations: [
          { kind: 'residency', place: 'FR' },
          { kind: 'citizenship', place: 'US' },
          { kind: 'work-permit', place: 'CA' },
          { kind: 'residency', place: 'MA' },
        ],
        acceptsSponsorship: null,
      }),
    ).toEqual(['MA', 'FR']);
  });
  it('is empty with no residence and no residency', () => {
    expect(
      homePlaces({
        residenceCountry: null,
        authorizations: [{ kind: 'citizenship', place: 'FR' }],
        acceptsSponsorship: null,
      }),
    ).toEqual([]);
  });
});

describe('residenceApplies', () => {
  const places = [country('GB')];
  it('a label applies only to facts from before the cut-over', () => {
    const applies = (
      placeStrictness: 'label' | 'limit',
      limitsBindPerson: boolean,
    ) =>
      residenceApplies(
        opening({ places, placeStrictness }),
        ['MA'],
        limitsBindPerson,
      );
    expect(applies('limit', true)).toBe(true);
    expect(applies('label', true)).toBe(false);
    expect(applies('limit', false)).toBe(true);
    expect(applies('label', false)).toBe(true);
  });
  it('skips mention, LinkedIn places, no places, no homes', () => {
    expect(
      residenceApplies(
        opening({ places, placeStrictness: 'mention' }),
        ['MA'],
        false,
      ),
    ).toBe(false);
    expect(
      residenceApplies(
        opening({ places, placeStrictness: 'limit', placesSource: 'linkedin' }),
        ['MA'],
        false,
      ),
    ).toBe(false);
    expect(residenceApplies(opening({ places: [] }), ['MA'], false)).toBe(
      false,
    );
    expect(
      residenceApplies(opening({ places, placeStrictness: 'limit' }), [], true),
    ).toBe(false);
  });
});

describe('livesIn', () => {
  it('a country is matched exactly', () => {
    expect(livesIn([country('GB')], ['GB'], idx)).toBe('yes');
    expect(livesIn([country('GB')], ['MA'], idx)).toBe('no');
  });
  it('several places, any one', () => {
    const places = [country('US'), country('CA')];
    expect(livesIn(places, ['CA'], idx)).toBe('yes');
    expect(livesIn(places, ['MA'], idx)).toBe('no');
  });
  it('a region contains its countries', () => {
    expect(livesIn([region('EUROPE')], ['GB'], idx)).toBe('yes');
    expect(livesIn([region('EUROPE')], ['MA'], idx)).toBe('no');
    expect(livesIn([region('EU')], ['GB'], idx)).toBe('no');
    expect(livesIn([region('EMEA')], ['MA'], idx)).toBe('yes');
  });
  it('a city counts by its country', () => {
    expect(livesIn([berlin], ['DE'], idx)).toBe('yes');
    expect(livesIn([berlin], ['MA'], idx)).toBe('no');
  });
  it('worldwide always fits', () => {
    expect(livesIn([{ kind: 'worldwide' }], ['MA'], idx)).toBe('yes');
  });
  it('an unknown region is maybe', () => {
    expect(livesIn([region('NORDICS')], ['MA'], idx)).toBe('maybe');
  });
  it('an unplaceable home is maybe', () => {
    expect(livesIn([country('GB')], ['XX'], idx)).toBe('maybe');
    expect(livesIn([country('GB')], ['UK'], idx)).toBe('maybe');
  });
  it('a city with no country and no known id is maybe', () => {
    const nowhere = {
      kind: 'city' as const,
      name: 'Nowhere',
      countryCode: null,
      cityId: 'not-in-index',
    };
    expect(livesIn([nowhere], ['MA'], idx)).toBe('maybe');
  });
  it('one unplaceable home makes a miss maybe', () => {
    expect(livesIn([country('GB')], ['XX', 'MA'], idx)).toBe('maybe');
  });
  it('a home region covers its countries', () => {
    expect(livesIn([country('FR')], ['EU'], idx)).toBe('yes');
  });
  it('any yes wins over maybe', () => {
    expect(livesIn([region('NORDICS'), country('MA')], ['MA'], idx)).toBe(
      'yes',
    );
  });
});
