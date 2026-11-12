import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { exampleProfile, factsDoc } from './fixtures.testing';
import type { PlaceIndex } from './places';
import type { MatchProfile } from './types';
import { checkWorkAuthorization } from './work-authorization';

type WorkAuthorization = NonNullable<
  JobFactsDocument['workAuthorization']['value']
>;
type Kind = WorkAuthorization['requirements'][number]['kind'];

const idx: PlaceIndex = {
  countriesOfRegion: new Map([
    ['EU', new Set(['FR', 'DE', 'ES'])],
    ['EMEA', new Set(['FR', 'DE', 'ES', 'MA', 'GB'])],
  ]),
  countryOfCity: new Map(),
};

const profile = (
  eligibility: Partial<MatchProfile['eligibility']> = {},
): MatchProfile => ({
  ...exampleProfile(),
  eligibility: {
    authorizations: [],
    residenceCountry: null,
    acceptsSponsorship: null,
    ...eligibility,
  },
});
const auth = (kind: Kind, place: string) => ({ kind, place });

const doc = (
  requirements: [Kind, string][] | null,
  sponsorship: WorkAuthorization['sponsorship'] = 'unstated',
  confidence: 'sure' | 'unsure' = 'sure',
) =>
  factsDoc((d) => {
    d.workAuthorization = {
      value: requirements && {
        requirements: requirements.map(([kind, place]) => ({ kind, place })),
        sponsorship,
      },
      confidence,
      source: 'description',
      quote: '',
    };
  });

const outcome = (d: JobFactsDocument, p: MatchProfile) =>
  checkWorkAuthorization(d, p, idx).outcome;

describe('checkWorkAuthorization', () => {
  it('citizenship meets work-permit', () => {
    const c = checkWorkAuthorization(
      doc([['work-permit', 'US']]),
      profile({ authorizations: [auth('citizenship', 'US')] }),
      idx,
    );
    expect(c).toMatchObject({
      rule: 'workAuthorization',
      outcome: 'pass',
      unsure: false,
    });
  });

  it('residenceCountry meets residency', () => {
    expect(
      outcome(doc([['residency', 'MA']]), profile({ residenceCountry: 'MA' })),
    ).toBe('pass');
    // A region requirement is met by a residence inside it.
    expect(
      outcome(doc([['residency', 'EU']]), profile({ residenceCountry: 'FR' })),
    ).toBe('pass');
    expect(
      outcome(doc([['residency', 'EU']]), profile({ residenceCountry: 'MA' })),
    ).toBe('fail');
    // residenceCountry meets residency only.
    expect(
      outcome(
        doc([['work-permit', 'MA']]),
        profile({ residenceCountry: 'MA' }),
      ),
    ).toBe('fail');
  });

  it('a work permit does not meet citizenship', () => {
    const c = checkWorkAuthorization(
      doc([['citizenship', 'US']]),
      profile({ authorizations: [auth('work-permit', 'US')] }),
      idx,
    );
    expect(c).toMatchObject({ outcome: 'fail', unsure: false });
    expect(c.reason).toContain('citizenship US');
  });

  it('a region authorization covers a country requirement', () => {
    expect(
      outcome(
        doc([['work-permit', 'FR']]),
        profile({ authorizations: [auth('work-permit', 'EU')] }),
      ),
    ).toBe('pass');
    expect(
      outcome(
        doc([['work-permit', 'MA']]),
        profile({ authorizations: [auth('work-permit', 'EU')] }),
      ),
    ).toBe('fail');
    // A region inside the authorized region.
    expect(
      outcome(
        doc([['work-permit', 'EU']]),
        profile({ authorizations: [auth('work-permit', 'EMEA')] }),
      ),
    ).toBe('pass');
  });

  it('a country authorization meets a requirement naming a region that contains it', () => {
    expect(
      outcome(
        doc([['citizenship', 'EU']]),
        profile({ authorizations: [auth('citizenship', 'FR')] }),
      ),
    ).toBe('pass');
  });

  it('unmet with sponsorship yes and acceptsSponsorship true passes', () => {
    const c = checkWorkAuthorization(
      doc([['work-permit', 'US']], 'yes'),
      profile({ acceptsSponsorship: true }),
      idx,
    );
    expect(c).toMatchObject({ outcome: 'pass', unsure: false });
    expect(c.reason).toContain('sponsor');
  });

  it('unmet with sponsorship unstated fails', () => {
    for (const sponsorship of ['unstated', 'no'] as const)
      expect(
        checkWorkAuthorization(
          doc([['work-permit', 'US']], sponsorship),
          profile({ acceptsSponsorship: true }),
          idx,
        ),
      ).toMatchObject({ outcome: 'fail', unsure: false });
  });

  it('acceptsSponsorship null counts as no', () => {
    for (const acceptsSponsorship of [null, false])
      expect(
        outcome(
          doc([['work-permit', 'US']], 'yes'),
          profile({ acceptsSponsorship }),
        ),
      ).toBe('fail');
  });

  it("citizenship can't be sponsored", () => {
    for (const kind of ['citizenship', 'clearance'] as const)
      expect(
        checkWorkAuthorization(
          doc([[kind, 'US']], 'yes'),
          profile({ acceptsSponsorship: true }),
          idx,
        ),
      ).toMatchObject({ outcome: 'fail', unsure: false });
  });

  it('no requirements is unknown', () => {
    expect(outcome(doc([]), profile())).toBe('unknown');
    expect(
      checkWorkAuthorization(doc(null, 'unstated', 'unsure'), profile(), idx),
    ).toMatchObject({ outcome: 'unknown', unsure: false });
  });

  it('every requirement must be met', () => {
    expect(
      outcome(
        doc([
          ['work-permit', 'FR'],
          ['clearance', 'FR'],
        ]),
        profile({ authorizations: [auth('citizenship', 'FR')] }),
      ),
    ).toBe('fail');
  });

  it('a requirement naming a region the index does not know is unknown', () => {
    expect(
      outcome(
        doc([['work-permit', 'APAC']]),
        profile({ authorizations: [auth('work-permit', 'FR')] }),
      ),
    ).toBe('unknown');
    // An authorization naming the same place still meets it.
    expect(
      outcome(
        doc([['work-permit', 'APAC']]),
        profile({ authorizations: [auth('work-permit', 'APAC')] }),
      ),
    ).toBe('pass');
  });

  describe('unsure', () => {
    it('an unmet requirement on an unsure fact is an unsure failure', () => {
      expect(
        checkWorkAuthorization(
          doc([['citizenship', 'US']], 'unstated', 'unsure'),
          profile(),
          idx,
        ),
      ).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'workAuthorization',
      });
    });

    it('unsure sponsorship that "yes" would rescue, for a user who accepts it, is unsure', () => {
      expect(
        checkWorkAuthorization(
          doc([['work-permit', 'US']], 'no', 'unsure'),
          profile({ acceptsSponsorship: true }),
          idx,
        ),
      ).toMatchObject({ outcome: 'fail', unsure: true });
    });

    it('a pass on an unsure fact rests on it', () => {
      expect(
        checkWorkAuthorization(
          doc([['work-permit', 'US']], 'unstated', 'unsure'),
          profile({ authorizations: [auth('citizenship', 'US')] }),
          idx,
        ),
      ).toMatchObject({
        outcome: 'pass',
        unsure: true,
        unsureField: 'workAuthorization',
      });
    });
  });
});
