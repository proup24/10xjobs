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
  arrangementSource: 'description',
  placesSource: 'description',
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

  describe('unsure', () => {
    const limited = (edit: Partial<Opening>) =>
      opening({
        arrangements: ['onsite'],
        places: [berlin],
        placeStrictness: 'limit',
        ...edit,
      });
    const check = (openings: Opening[], p = profile) =>
      checkLocation(openings, p, idx);

    it('an unsure description place that does not fit is unsure', () => {
      expect(check([limited({ confidence: 'unsure' })])).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'openings',
      });
    });
    it('a sure opening that does not fit is sure', () => {
      expect(check([limited({})])).toMatchObject({
        outcome: 'fail',
        unsure: false,
        unsureField: null,
      });
    });
    it('a LinkedIn place that does not fit is sure, whatever the opening confidence', () => {
      const p = exampleProfile();
      p.locations.remote = [];
      p.locations.hybrid = [];
      expect(
        check([limited({ confidence: 'unsure', placesSource: 'linkedin' })], p),
      ).toMatchObject({ outcome: 'fail', unsure: false });
    });
    it('an unwanted LinkedIn arrangement is sure', () => {
      const p = exampleProfile();
      p.locations.remote = [];
      expect(
        check(
          [opening({ confidence: 'unsure', arrangementSource: 'linkedin' })],
          p,
        ),
      ).toMatchObject({ outcome: 'fail', unsure: false });
    });
    it('an unwanted unsure description arrangement is unsure', () => {
      const p = exampleProfile();
      p.locations.remote = [];
      expect(check([opening({ confidence: 'unsure' })], p)).toMatchObject({
        outcome: 'fail',
        unsure: true,
      });
    });
    it('a LinkedIn place failing under an unsure description arrangement is unsure when another arrangement is wanted', () => {
      // Onsite in Berlin does not fit, but remote (wanted) might be the real arrangement.
      expect(
        check([limited({ confidence: 'unsure', placesSource: 'linkedin' })]),
      ).toMatchObject({ outcome: 'fail', unsure: true });
    });
    it('an unsure description arrangement ruling out a wanted one is sure when no arrangement would fit the place', () => {
      // Remote is wanted only in Morocco, on-site only in Casablanca: a Berlin label
      // fails whatever the arrangement really is.
      const p = exampleProfile();
      p.locations.remote = [{ kind: 'country', code: 'MA' }];
      p.locations.hybrid = [];
      p.locations.onsite = [{ kind: 'city', id: CITY_A }];
      expect(
        check(
          [
            limited({
              confidence: 'unsure',
              placesSource: 'linkedin',
              placeStrictness: 'label',
            }),
          ],
          p,
        ),
      ).toMatchObject({ outcome: 'fail', unsure: false, unsureField: null });
    });
    it('an unsure description arrangement ruling out a wanted one stays unsure when its unsure place might fit', () => {
      const p = exampleProfile();
      p.locations.remote = [{ kind: 'country', code: 'MA' }];
      p.locations.hybrid = [];
      p.locations.onsite = [];
      expect(check([limited({ confidence: 'unsure' })], p)).toMatchObject({
        outcome: 'fail',
        unsure: true,
      });
    });
    it('an unsure remote time zone that does not fit is unsure', () => {
      expect(
        check([
          opening({
            places: [{ kind: 'worldwide' }],
            placeStrictness: 'limit',
            timezones: [{ fromUtc: -8, toUtc: -6, label: 'x' }],
            confidence: 'unsure',
          }),
        ]),
      ).toMatchObject({ outcome: 'fail', unsure: true });
    });
    it('any unsure failing opening makes the failure unsure', () => {
      expect(
        check([limited({}), limited({ confidence: 'unsure' })]),
      ).toMatchObject({ outcome: 'fail', unsure: true });
    });
  });
});
