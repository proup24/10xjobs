import type { PlaceIndex } from 'src/modules/matcher/rules/places';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import {
  checkBeforeProcessing,
  onSiteDemand,
  type OnSiteDemand,
  type PrefilterJob,
} from './check';

const idx: PlaceIndex = {
  countriesOfRegion: new Map([['EU', new Set(['FR', 'DE'])]]),
  countryOfCity: new Map([['city-1', 'MA']]),
  countries: new Set(['FR', 'DE', 'MA', 'US']),
};

const none: PlacesByArrangement = {
  remote: [],
  hybrid: [],
  onsite: [],
};
const demandMA: OnSiteDemand = { anywhere: false, countries: new Set(['MA']) };

function job(over: Partial<PrefilterJob> = {}): PrefilterJob {
  return {
    workplaceType: 'onsite',
    countryCode: 'FR',
    remoteAllowed: false,
    title: 'Engineer',
    location: 'Paris',
    descriptionText: 'Come to the office.',
    ...over,
  };
}

describe('checkBeforeProcessing', () => {
  it('processes a remote-tagged job', () => {
    expect(
      checkBeforeProcessing(job({ workplaceType: 'remote' }), demandMA),
    ).toEqual({ process: true, why: 'tag' });
  });

  it('processes an untagged job', () => {
    expect(
      checkBeforeProcessing(job({ workplaceType: null }), demandMA),
    ).toEqual({ process: true, why: 'no_tag' });
  });

  it('processes a hybrid job with an unknown country', () => {
    const r = checkBeforeProcessing(
      job({ workplaceType: 'hybrid', countryCode: null }),
      demandMA,
    );
    expect(r).toEqual({ process: true, why: 'no_country' });
  });

  it('processes a job LinkedIn marks remoteAllowed', () => {
    const r = checkBeforeProcessing(job({ remoteAllowed: true }), demandMA);
    expect(r).toEqual({ process: true, why: 'remote_allowed' });
  });

  it('skips onsite in FR when no profile wants it', () => {
    expect(checkBeforeProcessing(job(), demandMA)).toEqual({
      process: false,
      reason: { version: 1, tag: 'onsite', country: 'FR' },
    });
  });

  it('skips with the hybrid tag too', () => {
    const r = checkBeforeProcessing(job({ workplaceType: 'hybrid' }), demandMA);
    expect(r).toMatchObject({ process: false, reason: { tag: 'hybrid' } });
  });

  it('processes the same job when the text mentions remote', () => {
    const r = checkBeforeProcessing(
      job({ descriptionText: 'Télétravail possible' }),
      demandMA,
    );
    expect(r).toMatchObject({ process: true, why: 'remote_words' });
  });

  it('reads the title and the location text for remote words', () => {
    expect(
      checkBeforeProcessing(job({ title: '𝗥𝗲𝗺𝗼𝘁𝗲 (𝗘𝗨)' }), demandMA),
    ).toMatchObject({ process: true, why: 'remote_words' });
    expect(
      checkBeforeProcessing(job({ location: 'Remote' }), demandMA),
    ).toMatchObject({ process: true, why: 'remote_words' });
  });

  it('processes hybrid in MA, where a profile wants it', () => {
    const r = checkBeforeProcessing(
      job({ workplaceType: 'hybrid', countryCode: 'MA' }),
      demandMA,
    );
    expect(r).toEqual({ process: true, why: 'demand' });
  });

  it('compares country codes case-insensitively', () => {
    const r = checkBeforeProcessing(job({ countryCode: 'ma' }), demandMA);
    expect(r).toEqual({ process: true, why: 'demand' });
  });

  it('processes everything when demand is anywhere', () => {
    const r = checkBeforeProcessing(job(), {
      anywhere: true,
      countries: new Set(),
    });
    expect(r).toEqual({ process: true, why: 'demand' });
  });
});

describe('onSiteDemand', () => {
  it('expands a region to its countries', () => {
    const d = onSiteDemand(
      [{ locations: { ...none, hybrid: [{ kind: 'region', code: 'EU' }] } }],
      idx,
    );
    expect(d).toEqual({ anywhere: false, countries: new Set(['FR', 'DE']) });
  });

  it('resolves a city id to its country', () => {
    const d = onSiteDemand(
      [{ locations: { ...none, onsite: [{ kind: 'city', id: 'city-1' }] } }],
      idx,
    );
    expect(d.countries).toEqual(new Set(['MA']));
  });

  it('merges hybrid and onsite places across profiles', () => {
    const d = onSiteDemand(
      [
        { locations: { ...none, hybrid: [{ kind: 'country', code: 'US' }] } },
        { locations: { ...none, onsite: [{ kind: 'country', code: 'FR' }] } },
      ],
      idx,
    );
    expect(d.countries).toEqual(new Set(['US', 'FR']));
  });

  it('gives anywhere for worldwide', () => {
    const d = onSiteDemand(
      [{ locations: { ...none, onsite: [{ kind: 'worldwide' }] } }],
      idx,
    );
    expect(d.anywhere).toBe(true);
  });

  it('gives anywhere for an unknown region or city', () => {
    const region = onSiteDemand(
      [{ locations: { ...none, hybrid: [{ kind: 'region', code: 'XX' }] } }],
      idx,
    );
    const city = onSiteDemand(
      [{ locations: { ...none, hybrid: [{ kind: 'city', id: 'nope' }] } }],
      idx,
    );
    expect(region.anywhere).toBe(true);
    expect(city.anywhere).toBe(true);
  });

  it('ignores remote places, even worldwide', () => {
    const d = onSiteDemand(
      [{ locations: { ...none, remote: [{ kind: 'worldwide' }] } }],
      idx,
    );
    expect(d).toEqual({ anywhere: false, countries: new Set() });
  });

  it('lets a worldwide hybrid profile pass every onsite job', () => {
    const d = onSiteDemand(
      [{ locations: { ...none, hybrid: [{ kind: 'worldwide' }] } }],
      idx,
    );
    expect(checkBeforeProcessing(job(), d)).toMatchObject({ process: true });
  });
});
