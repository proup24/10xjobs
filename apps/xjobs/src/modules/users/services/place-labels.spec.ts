import type { PlacesByArrangement } from '../types';
import { allPlaces, type PlaceLabels, placeTexts } from './place-labels';

const labels = (partial: Partial<PlaceLabels> = {}): PlaceLabels => ({
  regions: new Map(),
  countries: new Map(),
  cities: new Map(),
  ...partial,
});

describe('placeTexts', () => {
  it('turns each place into the text query search uses', () => {
    const places: PlacesByArrangement = {
      remote: [{ kind: 'region', code: 'EMEA' }, { kind: 'worldwide' }],
      hybrid: [],
      onsite: [{ kind: 'city', id: 'c1' }],
    };
    expect(
      placeTexts(
        places,
        labels({
          regions: new Map([['EMEA', 'EMEA']]),
          countries: new Map([['FR', 'France']]),
          cities: new Map([['c1', { name: 'Paris', countryCode: 'FR' }]]),
        }),
      ),
    ).toEqual({
      remote: ['EMEA', 'Worldwide'],
      hybrid: [],
      onsite: ['Paris, France'],
    });
  });

  it('turns a country into its label', () => {
    expect(
      placeTexts(
        { remote: [], hybrid: [{ kind: 'country', code: 'GB' }], onsite: [] },
        labels({ countries: new Map([['GB', 'United Kingdom']]) }),
      ),
    ).toEqual({ remote: [], hybrid: ['United Kingdom'], onsite: [] });
  });

  it.each<[string, PlacesByArrangement, string]>([
    [
      'region',
      { remote: [{ kind: 'region', code: 'MENA' }], hybrid: [], onsite: [] },
      'MENA',
    ],
    [
      'country',
      { remote: [{ kind: 'country', code: 'ZZ' }], hybrid: [], onsite: [] },
      'ZZ',
    ],
    [
      'city',
      { remote: [], hybrid: [], onsite: [{ kind: 'city', id: 'c9' }] },
      'c9',
    ],
  ])('throws naming the code of a %s with no label', (_kind, places, code) => {
    expect(() => placeTexts(places, labels())).toThrow(Error);
    expect(() => placeTexts(places, labels())).toThrow(code);
  });

  it('throws naming the country of a city whose country has no label', () => {
    const run = () =>
      placeTexts(
        { remote: [], hybrid: [], onsite: [{ kind: 'city', id: 'c1' }] },
        labels({
          cities: new Map([['c1', { name: 'Paris', countryCode: 'FR' }]]),
        }),
      );
    expect(run).toThrow('FR');
  });
});

describe('allPlaces', () => {
  it('lists the places of every arrangement', () => {
    expect(
      allPlaces({
        remote: [{ kind: 'worldwide' }],
        hybrid: [{ kind: 'country', code: 'FR' }],
        onsite: [{ kind: 'city', id: 'c1' }],
      }),
    ).toEqual([
      { kind: 'worldwide' },
      { kind: 'country', code: 'FR' },
      { kind: 'city', id: 'c1' },
    ]);
  });
});
