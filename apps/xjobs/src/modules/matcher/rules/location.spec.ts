import type { FactOpening as Opening } from 'src/modules/facts/schema/facts';
import { checkLocation } from './location';
import type { PlaceIndex } from './places';
import { CITY_A, CITY_B, exampleProfile } from './fixtures.testing';

const idx: PlaceIndex = {
  countriesOfRegion: new Map([['EU', new Set(['FR', 'DE'])]]),
  countryOfCity: new Map([
    [CITY_A, 'MA'],
    [CITY_B, 'FR'],
  ]),
};
const profile = exampleProfile();

const opening = (edit: Partial<Opening>): Opening => ({
  arrangements: ['remote'],
  places: [],
  placeStrictness: 'unstated',
  timezones: [],
  quote: '',
  confidence: 'sure',
  source: 'description',
  ...edit,
});
const berlin = {
  kind: 'city' as const,
  name: 'Berlin',
  countryCode: 'DE',
  cityId: 'berlin-id',
};
const outcome = (openings: Opening[], p = profile) =>
  checkLocation(openings, p, idx).outcome;

describe('checkLocation', () => {
  it('passes remote anywhere because the profile is worldwide', () => {
    expect(
      outcome([
        opening({
          places: [{ kind: 'country', code: 'US' }],
          placeStrictness: 'limit',
        }),
      ]),
    ).toBe('pass');
  });
  it('passes an onsite city the profile wants', () => {
    expect(
      outcome([
        opening({
          arrangements: ['onsite'],
          places: [
            { kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A },
          ],
          placeStrictness: 'limit',
        }),
      ]),
    ).toBe('pass');
  });
  it('fails an unwanted city when limited, unknown when merely mentioned', () => {
    const o = (placeStrictness: Opening['placeStrictness']) =>
      opening({ arrangements: ['onsite'], places: [berlin], placeStrictness });
    expect(outcome([o('limit')])).toBe('fail');
    expect(outcome([o('mention')])).toBe('unknown');
  });
  it('is unknown without places', () => {
    expect(outcome([opening({})])).toBe('unknown');
  });
  it('caps a match on only unstated arrangements to unknown', () => {
    expect(
      outcome([
        opening({
          arrangements: ['unstated'],
          places: [
            { kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A },
          ],
          placeStrictness: 'limit',
        }),
      ]),
    ).toBe('unknown');
  });
  it('the best opening wins', () => {
    expect(
      outcome([
        opening({
          arrangements: ['onsite'],
          places: [berlin],
          placeStrictness: 'limit',
        }),
        opening({ places: [{ kind: 'worldwide' }], placeStrictness: 'limit' }),
      ]),
    ).toBe('pass');
  });
  it('checks remote time zones against the profile range', () => {
    const tz = (fromUtc: number, toUtc: number) =>
      opening({
        places: [{ kind: 'worldwide' }],
        placeStrictness: 'limit',
        timezones: [{ fromUtc, toUtc, label: 'x' }],
      });
    expect(outcome([tz(-8, -6)])).toBe('fail');
    expect(outcome([tz(-5, -5)])).toBe('pass');
  });
  it('fails when the profile does not want the arrangement', () => {
    const p = exampleProfile();
    p.locations.remote = [];
    const check = checkLocation([opening({})], p, idx);
    expect(check.outcome).toBe('fail');
    expect(check.reason).toContain('remote');
  });
});
