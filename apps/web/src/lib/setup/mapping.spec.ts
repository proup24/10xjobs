// @vitest-environment node
import { SkillDomain } from '@xjobs/database/enums';
import { describe, expect, it } from 'vitest';
import type { JobAnswers, TermsAnswers } from './answers';
import {
  domainFor,
  fromProfile,
  jobColumns,
  jobSkills,
  masteryToRating,
  ratingToMastery,
  termsColumns,
  toProfileWrite,
  type ProfileRow,
  type SkillRow,
} from './mapping';

const BERLIN = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';

const job: JobAnswers = {
  position: 'frontend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior', 'staff'],
  techs: [
    { code: 'typescript', rating: 5, starred: true },
    { code: 'saas', rating: 2, starred: false },
  ],
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'de', level: 'native' },
  ],
};

const terms: TermsAnswers = {
  places: [
    {
      place: { kind: 'region', code: 'EU' },
      remote: true,
      hybrid: false,
      onsite: false,
    },
    {
      place: { kind: 'city', id: BERLIN },
      remote: false,
      hybrid: true,
      onsite: true,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 240,
  contractTypes: ['permanent'],
  engagements: ['employee'],
  noticePeriodDays: 30,
  salary: { min: 90000, currency: 'EUR', period: 'year' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR', 'USD'],
};

/** A stored profile row built from a write, as the database returns it. */
function storedRow(over: Partial<ProfileRow> = {}): ProfileRow {
  const { profile } = toProfileWrite(job, terms);
  return {
    ...profile,
    id: 'p1',
    userId: 'u1',
    state: 'draft',
    publishedAt: null,
    resumeFilename: null,
    resumeKey: null,
    resumeSha256: null,
    resumeSizeBytes: null,
    resumeUploadedAt: null,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
    ...over,
  };
}

function storedSkills(): SkillRow[] {
  return toProfileWrite(job, terms).skills.map((s, i) => ({
    ...s,
    id: `s${i}`,
    userId: 'u1',
    profileId: 'p1',
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
  }));
}

function skill(over: Partial<SkillRow>): SkillRow {
  return {
    id: 's',
    userId: 'u1',
    profileId: 'p1',
    technology: 'typescript',
    domain: 'backend',
    mastery: 6,
    importance: 5,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
    ...over,
  };
}

describe('domainFor', () => {
  it.each([
    ['backend_engineer', SkillDomain.backend],
    ['frontend_engineer', SkillDomain.frontend],
    ['fullstack_engineer', SkillDomain.fullstack],
    ['mobile_engineer', SkillDomain.mobile],
    ['devops_engineer', SkillDomain.devops],
    ['site_reliability_engineer', SkillDomain.devops],
    ['platform_engineer', SkillDomain.devops],
    ['cloud_engineer', SkillDomain.devops],
    ['data_engineer', SkillDomain.data],
    ['ml_engineer', SkillDomain.ml],
    ['ai_engineer', SkillDomain.ml],
    ['security_engineer', SkillDomain.security],
    ['qa_engineer', SkillDomain.qa],
    ['embedded_engineer', SkillDomain.backend],
    ['brand_new_code', SkillDomain.backend],
  ])('%s → %s', (position, domain) => {
    expect(domainFor(position)).toBe(domain);
  });
});

describe('rating ↔ mastery', () => {
  it('stores rating × 2', () => {
    expect([1, 2, 3, 4, 5].map((r) => ratingToMastery(r as 1))).toEqual([
      2, 4, 6, 8, 10,
    ]);
  });

  it.each([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
    [7, 4],
    [8, 4],
    [10, 5],
  ])('reads mastery %i as rating %i', (mastery, rating) => {
    expect(masteryToRating(mastery)).toBe(rating);
  });
});

describe('toProfileWrite', () => {
  it('writes exactly the create_profile_from_setup keys', () => {
    const { profile } = toProfileWrite(job, terms);
    expect(Object.keys(profile).sort()).toEqual(
      [
        'position',
        'yearsOfExperience',
        'timezoneCurrent',
        'timezoneMin',
        'timezoneMax',
        'engagements',
        'seniorities',
        'noticePeriodDays',
        'contractTypes',
        'locations',
        'languages',
        'salaryMin',
        'salaryCurrency',
        'salaryPeriod',
        'acceptsAnyCurrency',
        'acceptedCurrencies',
      ].sort(),
    );
    expect(profile).toMatchObject({
      position: 'frontend_engineer',
      yearsOfExperience: 6,
      seniorities: ['senior', 'staff'],
      languages: job.languages,
      timezoneCurrent: 60,
      timezoneMin: -120,
      timezoneMax: 240,
      contractTypes: ['permanent'],
      engagements: ['employee'],
      noticePeriodDays: 30,
      salaryMin: 90000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'year',
      acceptsAnyCurrency: false,
      acceptedCurrencies: ['EUR', 'USD'],
    });
  });

  it('gives importance 10 to a star, 5 otherwise, and the position domain to every skill', () => {
    expect(toProfileWrite(job, terms).skills).toEqual([
      {
        technology: 'typescript',
        domain: 'frontend',
        mastery: 10,
        importance: 10,
      },
      { technology: 'saas', domain: 'frontend', mastery: 4, importance: 5 },
    ]);
  });

  it('builds locations by arrangement in the place JSON the database accepts', () => {
    expect(toProfileWrite(job, terms).profile.locations).toEqual({
      remote: [{ kind: 'region', code: 'EU' }],
      hybrid: [{ kind: 'city', id: BERLIN }],
      onsite: [{ kind: 'city', id: BERLIN }],
    });
  });

  it('writes worldwide as the bare kind, with no stray keys', () => {
    const { profile } = toProfileWrite(job, {
      ...terms,
      places: [
        {
          place: { kind: 'worldwide', code: 'x' } as never,
          remote: true,
          hybrid: false,
          onsite: false,
        },
      ],
    });
    expect(profile.locations).toEqual({
      remote: [{ kind: 'worldwide' }],
      hybrid: [],
      onsite: [],
    });
  });

  it('writes the three salary keys as null without a salary', () => {
    expect(
      toProfileWrite(job, { ...terms, salary: null }).profile,
    ).toMatchObject({
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it('refuses an unrated tech', () => {
    expect(() =>
      toProfileWrite(
        { ...job, techs: [{ code: 'go', rating: null, starred: false }] },
        terms,
      ),
    ).toThrow();
  });

  it('is the two halves together', () => {
    expect(toProfileWrite(job, terms)).toEqual({
      profile: { ...jobColumns(job), ...termsColumns(terms) },
      skills: jobSkills(job),
    });
  });
});

describe('fromProfile', () => {
  it('round-trips the answers', () => {
    expect(fromProfile(storedRow(), storedSkills())).toEqual({ job, terms });
  });

  it('round-trips no salary and any currency', () => {
    const t = {
      ...terms,
      salary: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
    };
    const { profile } = toProfileWrite(job, t);
    expect(fromProfile(storedRow(profile), storedSkills()).terms).toEqual(t);
  });

  it('reads values setup never writes: mastery 7, importance 8, notice 45', () => {
    const r = fromProfile(storedRow({ noticePeriodDays: 45 }), [
      skill({ technology: 'typescript', mastery: 7, importance: 8 }),
    ]);
    expect(r.job.techs).toEqual([
      { code: 'typescript', rating: 4, starred: true },
    ]);
    expect(r.terms.noticePeriodDays).toBe(30);
  });

  it('merges a place listed under several arrangements into one row, in first-seen order', () => {
    const r = fromProfile(
      storedRow({
        locations: {
          remote: [{ kind: 'country', code: 'DE' }],
          hybrid: [
            { kind: 'city', id: BERLIN.toUpperCase() },
            { kind: 'country', code: 'DE' },
          ],
          onsite: [{ kind: 'city', id: BERLIN }],
        },
      }),
      storedSkills(),
    );
    expect(r.terms.places).toEqual([
      {
        place: { kind: 'country', code: 'DE' },
        remote: true,
        hybrid: true,
        onsite: false,
      },
      {
        place: { kind: 'city', id: BERLIN },
        remote: false,
        hybrid: true,
        onsite: true,
      },
    ]);
  });

  it('keeps only remote for worldwide, dropping a row left with nothing', () => {
    const r = fromProfile(
      storedRow({
        locations: {
          remote: [],
          hybrid: [{ kind: 'worldwide' }],
          onsite: [{ kind: 'country', code: 'DE' }],
        },
      }),
      storedSkills(),
    );
    expect(r.terms.places).toEqual([
      {
        place: { kind: 'country', code: 'DE' },
        remote: false,
        hybrid: false,
        onsite: true,
      },
    ]);
  });

  it('stars at most two searchable techs, by importance then mastery then name', () => {
    const r = fromProfile(storedRow(), [
      skill({ technology: 'saas', mastery: 10, importance: 10 }),
      skill({ technology: 'rust', mastery: 6, importance: 9 }),
      skill({ technology: 'go', mastery: 8, importance: 9 }),
      skill({ technology: 'python', mastery: 8, importance: 9 }),
    ]);
    expect(r.job.techs).toEqual([
      { code: 'saas', rating: 5, starred: false },
      { code: 'rust', rating: 3, starred: false },
      { code: 'go', rating: 4, starred: true },
      { code: 'python', rating: 4, starred: true },
    ]);
  });

  it('merges a tech stored under two domains into one row', () => {
    const r = fromProfile(storedRow(), [
      skill({ technology: 'typescript', domain: 'backend', mastery: 6 }),
      skill({
        technology: 'typescript',
        domain: 'frontend',
        mastery: 9,
        importance: 7,
      }),
    ]);
    expect(r.job.techs).toEqual([
      { code: 'typescript', rating: 5, starred: true },
    ]);
  });

  it('drops values the step lists never offer and malformed JSON entries', () => {
    const r = fromProfile(
      storedRow({
        seniorities: ['unstated', 'senior'],
        contractTypes: ['unstated'],
        engagements: ['employee', 'unstated'],
        languages: [
          { lang: 'en', level: 'fluent' },
          { lang: 'en', level: 'native' },
          { lang: 'fr', level: 'basic' },
          'de',
        ],
        locations: {
          remote: [{ kind: 'planet', code: 'MARS' }, { kind: 'worldwide' }],
          hybrid: [],
          onsite: [],
        },
      }),
      storedSkills(),
    );
    expect(r.job.seniorities).toEqual(['senior']);
    expect(r.terms.contractTypes).toEqual([]);
    expect(r.terms.engagements).toEqual(['employee']);
    expect(r.job.languages).toEqual([{ lang: 'en', level: 'fluent' }]);
    expect(r.terms.places).toEqual([
      {
        place: { kind: 'worldwide' },
        remote: true,
        hybrid: false,
        onsite: false,
      },
    ]);
  });
});
