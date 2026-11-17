import type { FactOpening, FactWorkAuthorization } from '../schema/facts';
import { deriveFromNoSponsorship } from './no-sponsorship';

const wa = (
  sponsorship: FactWorkAuthorization['sponsorship'],
  requirements: FactWorkAuthorization['requirements'] = [],
): FactWorkAuthorization => ({ requirements, sponsorship });

const opening = (p: Partial<FactOpening> = {}): FactOpening => ({
  arrangements: ['unstated'],
  places: [],
  placeStrictness: 'label',
  timezones: [],
  quote: '',
  confidence: 'sure',
  arrangementSource: 'description',
  placesSource: 'description',
  ...p,
});

const derived = (...places: string[]): FactWorkAuthorization =>
  wa(
    'no',
    places.map((place) => ({
      kind: 'work-permit' as const,
      place,
      derived: 'no-sponsorship' as const,
    })),
  );

const country = (code: string): FactOpening['places'][number] => ({
  kind: 'country',
  code,
});
const US = { kind: 'country', code: 'US' } as const;

describe('deriveFromNoSponsorship', () => {
  it('returns null for a null value', () => {
    expect(deriveFromNoSponsorship(null, [opening()], US)).toBeNull();
  });

  it.each(['yes', 'unstated'] as const)('leaves sponsorship %s', (s) => {
    const value = wa(s);
    expect(
      deriveFromNoSponsorship(
        value,
        [opening({ places: [country('US')] })],
        US,
      ),
    ).toBe(value);
  });

  it('leaves an explicit requirement', () => {
    const value = wa('no', [{ kind: 'citizenship', place: 'FR' }]);
    expect(
      deriveFromNoSponsorship(
        value,
        [opening({ places: [country('US')] })],
        US,
      ),
    ).toBe(value);
  });

  it('derives from a description country', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [opening({ places: [country('US')] })],
        null,
      ),
    ).toEqual({
      requirements: [
        { kind: 'work-permit', place: 'US', derived: 'no-sponsorship' },
      ],
      sponsorship: 'no',
    });
  });

  it('derives a city country and a region in opening order', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [
          opening({
            places: [
              { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: null },
              { kind: 'region', code: 'EU' },
            ],
          }),
        ],
        null,
      ),
    ).toEqual(derived('FR', 'EU'));
  });

  it('merges the same place in different case', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [
          opening({ places: [country('US')] }),
          opening({ places: [country('us')] }),
        ],
        null,
      ),
    ).toEqual(derived('US'));
  });

  it('falls back to the listing place when openings have no places', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [
          opening({
            places: [],
            placeStrictness: 'unstated',
            timezones: [{ fromUtc: -8, toUtc: -5, label: 'US time zones' }],
          }),
        ],
        US,
      ),
    ).toEqual(derived('US'));
  });

  it('ignores mention-only description places', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [opening({ places: [country('FR')], placeStrictness: 'mention' })],
        US,
      ),
    ).toEqual(derived('US'));
  });

  it('falls back when a description city has no country', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [
          opening({
            places: [
              {
                kind: 'city',
                name: 'Springfield',
                countryCode: null,
                cityId: null,
              },
            ],
          }),
        ],
        US,
      ),
    ).toEqual(derived('US'));
  });

  it('ignores the listing place when the description has places', () => {
    expect(
      deriveFromNoSponsorship(
        wa('no'),
        [opening({ places: [country('FR')] })],
        US,
      ),
    ).toEqual(derived('FR'));
  });

  it('derives nothing for a worldwide place', () => {
    const value = wa('no');
    expect(
      deriveFromNoSponsorship(
        value,
        [opening({ places: [{ kind: 'worldwide' }] })],
        US,
      ),
    ).toEqual(value);
    expect(
      deriveFromNoSponsorship(value, [opening({ places: [] })], {
        kind: 'worldwide',
      }),
    ).toEqual(value);
  });

  it('derives nothing without places', () => {
    const value = wa('no');
    expect(
      deriveFromNoSponsorship(value, [opening({ places: [] })], null),
    ).toEqual(value);
  });
});
