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
  countries: new Set(['MA', 'FR']),
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
  checkLocation(openings, p, idx, true).outcome;

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
  it('a mentioned place binds hybrid and onsite, not remote', () => {
    const o = (arrangements: Opening['arrangements']) =>
      opening({ arrangements, places: [berlin], placeStrictness: 'mention' });
    const p = exampleProfile();
    p.locations.remote = [{ kind: 'country', code: 'MA' }];
    expect(outcome([o(['onsite'])], p)).toBe('fail');
    expect(outcome([o(['hybrid'])], p)).toBe('fail');
    expect(outcome([o(['remote'])], p)).toBe('unknown');
  });
  it('a mentioned office that fits passes', () => {
    expect(
      outcome([
        opening({
          arrangements: ['hybrid'],
          places: [
            berlin,
            { kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A },
          ],
          placeStrictness: 'mention',
        }),
      ]),
    ).toBe('pass');
  });
  it('is unknown without places', () => {
    expect(outcome([opening({})])).toBe('unknown');
  });
  it('an opening with no arrangement passes on an office place that fits', () => {
    expect(
      outcome([
        opening({
          arrangements: ['unstated'],
          places: [
            { kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A },
          ],
          placeStrictness: 'label',
          placesSource: 'linkedin',
        }),
      ]),
    ).toBe('pass');
  });
  it('an opening with no arrangement fails surely outside the office places, with its cause', () => {
    const c = checkLocation(
      [
        opening({
          arrangements: ['unstated'],
          places: [berlin],
          placeStrictness: 'label',
          placesSource: 'linkedin',
          confidence: 'unsure',
        }),
      ],
      profile,
      idx,
      true,
    );
    expect(c).toMatchObject({ outcome: 'fail', unsure: false });
    expect(c.reason).toBe(
      'no source states the arrangement, so it is checked as office-based: job location (unstated in Berlin) does not fit your wanted arrangements (hybrid, onsite)',
    );
    const noHybrid = exampleProfile();
    noHybrid.locations.hybrid = [];
    expect(
      checkLocation(
        [
          opening({
            arrangements: ['unstated'],
            places: [berlin],
            placeStrictness: 'label',
            placesSource: 'linkedin',
            confidence: 'unsure',
          }),
        ],
        noHybrid,
        idx,
        true,
      ).reason,
    ).toBe(
      'no source states the arrangement, so it is checked as office-based: job location (unstated in Berlin) does not fit your wanted arrangements (onsite)',
    );
  });
  it('an opening with no arrangement and no place is unknown with office places, fail without', () => {
    const remoteOnly = exampleProfile();
    remoteOnly.locations.hybrid = [];
    remoteOnly.locations.onsite = [];
    const bare = opening({ arrangements: ['unstated'] });
    expect(outcome([bare])).toBe('unknown');
    expect(outcome([bare], remoteOnly)).toBe('fail');
  });
  it('stated plus unstated keeps every arrangement', () => {
    expect(
      outcome([
        opening({
          arrangements: ['remote', 'unstated'],
          places: [berlin],
          placeStrictness: 'label',
        }),
      ]),
    ).toBe('pass');
  });
  it('an opening with no arrangement and an unplaceable city is unknown', () => {
    expect(
      outcome([
        opening({
          arrangements: ['unstated'],
          places: [
            { kind: 'city', name: 'Nowhere', countryCode: null, cityId: null },
          ],
          placeStrictness: 'label',
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
    const check = checkLocation([opening({})], p, idx, true);
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
      checkLocation(openings, p, idx, true);

    it('an unsure description place that does not fit is unsure', () => {
      expect(check([limited({ confidence: 'unsure' })])).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'openings',
      });
    });
    it('a mentioned hybrid place that fails is sure, even on an unsure opening', () => {
      expect(
        check([
          opening({
            arrangements: ['hybrid'],
            places: [berlin],
            placeStrictness: 'mention',
            confidence: 'unsure',
          }),
        ]),
      ).toMatchObject({ outcome: 'fail', unsure: false, unsureField: null });
    });
    it('a mentioned hybrid place that fails stays unsure when the remote route fails on unsure time zones', () => {
      expect(
        check([
          opening({
            arrangements: ['hybrid', 'remote'],
            places: [berlin],
            placeStrictness: 'mention',
            timezones: [{ fromUtc: 9, toUtc: 10, label: 'x' }],
            confidence: 'unsure',
          }),
        ]),
      ).toMatchObject({ outcome: 'fail', unsure: true });
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

describe('residence', () => {
  const ridx: PlaceIndex = {
    countriesOfRegion: new Map([
      ['EU', new Set(['FR', 'DE'])],
      ['EUROPE', new Set(['FR', 'DE', 'GB'])],
      ['EMEA', new Set(['FR', 'DE', 'GB', 'MA'])],
      ['UK', new Set(['GB'])],
    ]),
    countryOfCity: new Map(),
    countries: new Set(['MA', 'FR', 'DE', 'GB', 'US', 'CA']),
  };
  const country = (code: string) => ({ kind: 'country' as const, code });
  const region = (code: string) => ({ kind: 'region' as const, code });
  const berlinDE = {
    kind: 'city' as const,
    name: 'Berlin',
    countryCode: 'DE',
    cityId: null,
  };
  const strict = (
    places: Opening['places'],
    placeStrictness: Opening['placeStrictness'] = 'limit',
  ) => opening({ places, placeStrictness });
  const resident = (
    residenceCountry: string | null,
    authorizations: { kind: string; place: string }[] = [],
    edit?: (p: ReturnType<typeof exampleProfile>) => void,
  ) => {
    const p = exampleProfile();
    p.eligibility = { ...p.eligibility, residenceCountry, authorizations };
    edit?.(p);
    return p;
  };
  const check = (
    openings: Opening[],
    p: ReturnType<typeof exampleProfile>,
    limitsBindPerson = true,
  ) => checkLocation(openings, p, ridx, limitsBindPerson);
  const outcomeOf = (o: Opening, p: ReturnType<typeof exampleProfile>) =>
    check([o], p).outcome;

  const columns: Opening['places'][] = [
    [country('US')],
    [country('US'), country('CA')],
    [region('EUROPE')],
    [region('EU')],
    [region('EMEA')],
    [berlinDE],
  ];
  const table: [string, string[]][] = [
    ['MA', ['fail', 'fail', 'fail', 'fail', 'pass', 'fail']],
    ['DE', ['fail', 'fail', 'pass', 'pass', 'pass', 'pass']],
    ['US', ['pass', 'pass', 'fail', 'fail', 'fail', 'fail']],
    ['GB', ['fail', 'fail', 'pass', 'fail', 'pass', 'fail']],
  ];
  it.each(table)(
    'a %s resident fits only places that include home',
    (home, expected) => {
      const p = resident(home);
      expect(columns.map((places) => outcomeOf(strict(places), p))).toEqual(
        expected,
      );
    },
  );

  it('the Solvex case (a label) passes; the same place as a limit fails on residence', () => {
    const p = resident('MA', [], (x) => {
      x.locations.remote = [region('UK')];
    });
    expect(check([strict([country('GB')], 'label')], p).outcome).toBe('pass');
    expect(check([strict([country('GB')], 'limit')], p)).toMatchObject({
      outcome: 'fail',
      reason:
        'job location (remote in GB, stated in the description) requires living there; you live in MA',
    });
  });
  it('a limit fails with the residence reason and detail', () => {
    const p = resident('MA', [], (x) => {
      x.locations.remote = [region('UK')];
    });
    const c = check([strict([country('GB')])], p);
    expect(c).toMatchObject({
      outcome: 'fail',
      unsure: false,
      reason:
        'job location (remote in GB, stated in the description) requires living there; you live in MA',
    });
    expect((c.detail as { residence: unknown }[])[0].residence).toEqual({
      homes: ['MA'],
      fits: 'no',
      decided: true,
    });
  });
  it('a residence pass is stored as not deciding', () => {
    const c = check([strict([country('GB')])], resident('GB'));
    expect(c.outcome).toBe('pass');
    expect((c.detail as { residence: unknown }[])[0].residence).toEqual({
      homes: ['GB'],
      fits: 'yes',
      decided: false,
    });
  });
  it('the residence reason names only the openings that failed on residence', () => {
    const c = check(
      [
        strict([country('GB')]),
        opening({
          arrangements: ['onsite'],
          places: [berlin],
          placeStrictness: 'limit',
          arrangementSource: 'linkedin',
          placesSource: 'linkedin',
        }),
      ],
      resident('MA'),
    );
    expect(c.outcome).toBe('fail');
    expect(c.reason).toBe(
      'job location (remote in GB, stated in the description) requires living there; you live in MA',
    );
  });
  describe('unstated arrangements', () => {
    const unstated = opening({
      arrangements: ['unstated'],
      places: [country('GB')],
      placeStrictness: 'label',
    });
    it('fail surely for a remote-only profile', () => {
      const p = resident('MA', [], (x) => {
        x.locations.hybrid = [];
        x.locations.onsite = [];
      });
      expect(check([unstated], p)).toMatchObject({
        outcome: 'fail',
        unsure: false,
      });
    });
    it('pass when an on-site place fits', () => {
      const p = resident('MA', [], (x) => {
        x.locations.onsite = [country('GB')];
      });
      expect(check([unstated], p).outcome).toBe('pass');
    });
  });
  it('a label is not checked against residence', () => {
    expect(outcomeOf(strict([country('GB')], 'label'), resident('MA'))).toBe(
      'pass',
    );
  });
  it('a label still binds residence on facts from before the cut-over', () => {
    const c = check([strict([country('GB')], 'label')], resident('MA'), false);
    expect(c).toMatchObject({
      outcome: 'fail',
      reason:
        'job location (remote in GB, stated in the description) requires living there; you live in MA',
    });
  });
  it("no residence keeps today's outcome", () => {
    const c = check([strict([country('GB')])], resident(null));
    expect(c.outcome).toBe('pass');
    expect((c.detail as { residence: unknown }[])[0].residence).toBeNull();
  });
  it('a residency authorization counts, citizenship does not', () => {
    expect(
      outcomeOf(
        strict([country('GB')]),
        resident('MA', [{ kind: 'residency', place: 'GB' }]),
      ),
    ).toBe('pass');
    expect(
      outcomeOf(
        strict([country('GB')]),
        resident('MA', [{ kind: 'citizenship', place: 'GB' }]),
      ),
    ).toBe('fail');
  });
  it('mention and LinkedIn places are not checked', () => {
    const p = resident('MA');
    expect(outcomeOf(strict([country('GB')], 'mention'), p)).toBe('pass');
    expect(
      outcomeOf({ ...strict([country('GB')]), placesSource: 'linkedin' }, p),
    ).toBe('pass');
  });
  it('an unknown region goes to review, not reject', () => {
    expect(outcomeOf(strict([region('NORDICS')]), resident('MA'))).toBe(
      'unknown',
    );
  });
  it('onsite and hybrid are not checked', () => {
    const p = resident('MA', [], (x) => {
      x.locations.remote = [];
      x.locations.onsite = [country('GB')];
    });
    const c = check(
      [
        opening({
          arrangements: ['onsite'],
          places: [country('GB')],
          placeStrictness: 'limit',
        }),
      ],
      p,
    );
    expect(c.outcome).toBe('pass');
    expect((c.detail as { residence: unknown }[])[0].residence).toBeNull();
  });
  it("an unsure opening's residence failure is unsure", () => {
    expect(
      check(
        [{ ...strict([country('GB')]), confidence: 'unsure' }],
        resident('MA'),
      ),
    ).toMatchObject({ outcome: 'fail', unsure: true, unsureField: 'openings' });
  });
  it('another opening still fits', () => {
    const p = resident('MA');
    expect(
      check([strict([country('GB')]), strict([country('MA')])], p).outcome,
    ).toBe('pass');
    expect(
      check([strict([country('GB')]), strict([country('GB')], 'mention')], p)
        .outcome,
    ).toBe('pass');
  });
  it('a fitting hybrid side survives a remote residence failure', () => {
    const p = resident('MA', [], (x) => {
      x.locations.hybrid = [country('GB')];
    });
    const c = check(
      [{ ...strict([country('GB')]), arrangements: ['remote', 'hybrid'] }],
      p,
    );
    expect(c.outcome).toBe('pass');
    expect((c.detail as { decidedBy: unknown }[])[0].decidedBy).toBe('hybrid');
  });
  it('time zones still fail after a residence pass', () => {
    const c = check(
      [
        {
          ...strict([country('GB')]),
          timezones: [{ fromUtc: 9, toUtc: 10, label: 'x' }],
        },
      ],
      resident('GB'),
    );
    expect(c.outcome).toBe('fail');
    expect(c.reason).toBe(
      'job location (remote in GB) does not fit your wanted arrangements (remote, hybrid, onsite)',
    );
  });
});
