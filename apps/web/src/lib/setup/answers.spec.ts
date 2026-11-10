// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  aboutSchema,
  eligibilitySchema,
  jobSchema,
  parseDraft,
  parseNewProfileDraft,
  termsSchema,
  type AboutAnswers,
  type EligibilityAnswers,
  type JobAnswers,
  type TermsAnswers,
} from './answers';

const BERLIN = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';
const searchable = (code: string) => code !== 'saas';
const job = jobSchema(searchable);

/** Every issue path of a failed parse, dotted. */
function paths(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

const about: AboutAnswers = {
  name: 'Ada Lovelace',
  phone: null,
  linkedin: null,
  links: [{ kind: 'github', value: 'https://github.com/ada' }],
};

const eligibility: EligibilityAnswers = {
  residenceCountry: 'DE',
  acceptsSponsorship: true,
  authorizations: [{ kind: 'citizenship', place: 'DE' }],
  noneConfirmed: false,
};

const jobAnswers: JobAnswers = {
  position: 'backend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior'],
  techs: [
    { code: 'typescript', rating: 5 },
    { code: 'saas', rating: 3 },
  ],
  languages: [{ lang: 'en', level: 'fluent' }],
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
  acceptsAnyCurrency: true,
  acceptedCurrencies: [],
};

describe('aboutSchema', () => {
  it('accepts a valid answer and trims the name', () => {
    const r = aboutSchema.parse({ ...about, name: '  Ada  ' });
    expect(r.name).toBe('Ada');
  });

  it('refuses an empty name', () => {
    expect(paths(aboutSchema, { ...about, name: '   ' })).toEqual(['name']);
  });

  it('refuses a name over 200 chars', () => {
    expect(paths(aboutSchema, { ...about, name: 'a'.repeat(201) })).toEqual([
      'name',
    ]);
  });

  it('refuses a link that is not http(s)', () => {
    expect(
      paths(aboutSchema, {
        ...about,
        links: [{ kind: 'website', value: 'javascript:alert(1)' }],
      }),
    ).toEqual(['links.0.value']);
    expect(
      paths(aboutSchema, {
        ...about,
        links: [{ kind: 'website', value: 'not a url' }],
      }),
    ).toEqual(['links.0.value']);
  });

  it('refuses a duplicate link', () => {
    expect(
      paths(aboutSchema, {
        ...about,
        links: [about.links[0], about.links[0]],
      }),
    ).toEqual(['links.1.value']);
  });

  it('allows the same URL under two kinds', () => {
    expect(
      paths(aboutSchema, {
        ...about,
        links: [
          { kind: 'portfolio', value: 'https://ada.dev' },
          { kind: 'website', value: 'https://ada.dev' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('eligibilitySchema', () => {
  it('accepts a valid answer', () => {
    expect(paths(eligibilitySchema, eligibility)).toEqual([]);
  });

  it('empty authorizations without noneConfirmed is refused', () => {
    expect(
      paths(eligibilitySchema, { ...eligibility, authorizations: [] }),
    ).toEqual(['noneConfirmed']);
  });

  it('empty authorizations with noneConfirmed is accepted', () => {
    expect(
      paths(eligibilitySchema, {
        ...eligibility,
        authorizations: [],
        noneConfirmed: true,
      }),
    ).toEqual([]);
  });

  it('refuses a duplicate authorization', () => {
    expect(
      paths(eligibilitySchema, {
        ...eligibility,
        authorizations: [
          eligibility.authorizations[0],
          eligibility.authorizations[0],
        ],
      }),
    ).toEqual(['authorizations.1']);
  });

  it('refuses an unknown authorization kind', () => {
    expect(
      paths(eligibilitySchema, {
        ...eligibility,
        authorizations: [{ kind: 'visa', place: 'DE' }],
      }),
    ).toEqual(['authorizations.0.kind']);
  });
});

describe('jobSchema', () => {
  it('accepts a valid answer', () => {
    expect(paths(job, jobAnswers)).toEqual([]);
  });

  it.each([-1, 61, 2.5])('refuses %d years of experience', (years) => {
    expect(paths(job, { ...jobAnswers, yearsOfExperience: years })).toEqual([
      'yearsOfExperience',
    ]);
  });

  it('needs at least one seniority', () => {
    expect(paths(job, { ...jobAnswers, seniorities: [] })).toEqual([
      'seniorities',
    ]);
  });

  it('needs every tech rated, at the tech row', () => {
    expect(
      paths(job, {
        ...jobAnswers,
        techs: [jobAnswers.techs[0], { code: 'saas', rating: null }],
      }),
    ).toEqual(['techs.1.rating']);
  });

  it('needs one tech we can search for', () => {
    const r = job.safeParse({
      ...jobAnswers,
      techs: [{ code: 'saas', rating: 3 }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['techs', 'Add at least one tech we can search for'],
    ]);
  });

  it('refuses the same tech twice', () => {
    expect(
      paths(job, {
        ...jobAnswers,
        techs: [jobAnswers.techs[0], { ...jobAnswers.techs[0] }],
      }),
    ).toEqual(['techs.1.code']);
  });

  it('needs at least one language', () => {
    expect(paths(job, { ...jobAnswers, languages: [] })).toEqual(['languages']);
  });

  it('refuses the same language twice', () => {
    expect(
      paths(job, {
        ...jobAnswers,
        languages: [
          { lang: 'en', level: 'fluent' },
          { lang: 'en', level: 'native' },
        ],
      }),
    ).toEqual(['languages.1.lang']);
  });
});

describe('termsSchema', () => {
  const row = (over: Partial<TermsAnswers['places'][number]>) => ({
    place: { kind: 'country', code: 'DE' } as const,
    remote: true,
    hybrid: false,
    onsite: false,
    ...over,
  });

  it('accepts a valid answer', () => {
    expect(paths(termsSchema, terms)).toEqual([]);
  });

  it('accepts no salary', () => {
    expect(paths(termsSchema, { ...terms, salary: null })).toEqual([]);
  });

  it('needs at least one place', () => {
    expect(paths(termsSchema, { ...terms, places: [] })).toEqual(['places']);
  });

  it('needs at least one arrangement per row', () => {
    expect(
      paths(termsSchema, { ...terms, places: [row({ remote: false })] }),
    ).toEqual(['places.0']);
  });

  it('refuses the same place twice (city ids in any case)', () => {
    expect(
      paths(termsSchema, {
        ...terms,
        places: [
          row({ place: { kind: 'city', id: BERLIN } }),
          row({ place: { kind: 'city', id: BERLIN.toUpperCase() } }),
        ],
      }),
    ).toEqual(['places.1.place']);
  });

  it('refuses GLOBAL', () => {
    expect(
      paths(termsSchema, {
        ...terms,
        places: [row({ place: { kind: 'region', code: 'GLOBAL' } })],
      }),
    ).toEqual(['places.0.place']);
  });

  it('GLOBAL asks for regions instead', () => {
    const r = termsSchema.safeParse({
      ...terms,
      places: [row({ place: { kind: 'region', code: 'GLOBAL' } })],
    });
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'Pick the regions you want instead',
    ]);
  });

  it('refuses a worldwide place', () => {
    expect(
      paths(termsSchema, {
        ...terms,
        places: [row({ place: { kind: 'worldwide' } as never })],
      }),
    ).not.toEqual([]);
  });

  it('refuses a malformed city id', () => {
    expect(
      paths(termsSchema, {
        ...terms,
        places: [row({ place: { kind: 'city', id: 'berlin' } })],
      }),
    ).toEqual(['places.0.place.id']);
  });

  it('refuses more than 20 places in one arrangement', () => {
    const places = Array.from({ length: 21 }, (_, i) =>
      row({ place: { kind: 'country', code: `C${i}` } }),
    );
    expect(paths(termsSchema, { ...terms, places })).toEqual(['places']);
    expect(
      paths(termsSchema, { ...terms, places: places.slice(0, 20) }),
    ).toEqual([]);
  });

  it('refuses a range that ends before it starts', () => {
    expect(
      paths(termsSchema, { ...terms, timezoneMin: 120, timezoneMax: 60 }),
    ).toEqual(['timezoneMax']);
  });

  it('refuses an offset outside -720..840', () => {
    expect(paths(termsSchema, { ...terms, timezoneMax: 900 })).toEqual([
      'timezoneMax',
    ]);
  });

  it.each(['timezoneCurrent', 'timezoneMin', 'timezoneMax'] as const)(
    'refuses a %s that is not an offered offset',
    (field) => {
      expect(
        paths(termsSchema, {
          ...terms,
          timezoneMin: -180,
          timezoneMax: 240,
          [field]: 150,
        }),
      ).toEqual([field]);
    },
  );

  it('needs a contract type and an engagement', () => {
    expect(
      paths(termsSchema, { ...terms, contractTypes: [], engagements: [] }),
    ).toEqual(['contractTypes', 'engagements']);
  });

  it('refuses a notice period that is not an option', () => {
    expect(paths(termsSchema, { ...terms, noticePeriodDays: 45 })).toEqual([
      'noticePeriodDays',
    ]);
  });

  it.each([
    [
      'a zero amount',
      { min: 0, currency: 'EUR', period: 'year' },
      'salary.min',
    ],
    [
      'a fractional amount',
      { min: 10.5, currency: 'EUR', period: 'year' },
      'salary.min',
    ],
    [
      'a bad currency',
      { min: 10, currency: 'euro', period: 'year' },
      'salary.currency',
    ],
    [
      'a bad period',
      { min: 10, currency: 'EUR', period: 'week' },
      'salary.period',
    ],
  ])('refuses a salary with %s', (_, salary, path) => {
    expect(paths(termsSchema, { ...terms, salary })).toEqual([path]);
  });

  it('refuses any currency with a list', () => {
    expect(
      paths(termsSchema, { ...terms, acceptedCurrencies: ['EUR'] }),
    ).toEqual(['acceptedCurrencies']);
  });

  it('refuses specific currencies with an empty list', () => {
    expect(paths(termsSchema, { ...terms, acceptsAnyCurrency: false })).toEqual(
      ['acceptedCurrencies'],
    );
    expect(
      paths(termsSchema, {
        ...terms,
        acceptsAnyCurrency: false,
        acceptedCurrencies: ['EUR', 'USD'],
      }),
    ).toEqual([]);
  });
});

describe('parseDraft', () => {
  it('reads a version 1 draft', () => {
    expect(parseDraft({ version: 1, job: jobAnswers, terms })).toEqual({
      version: 1,
      job: jobAnswers,
      terms,
    });
    expect(parseDraft({ version: 1 })).toEqual({ version: 1 });
  });

  it('is null for another version', () => {
    expect(parseDraft({ version: 2 })).toBeNull();
  });

  it.each([null, undefined, 'x', 42, [], {}])('is null for %j', (json) => {
    expect(parseDraft(json)).toBeNull();
  });

  it('parseDraft drops worldwide rows', () => {
    const emea = {
      place: { kind: 'region', code: 'EMEA' },
      remote: true,
      hybrid: false,
      onsite: false,
    };
    const worldwide = { ...emea, place: { kind: 'worldwide' } };
    expect(
      parseDraft({
        version: 1,
        terms: { ...terms, places: [worldwide, emea] },
      })?.terms?.places,
    ).toEqual([emea]);
  });

  it('ignores a stored starred key on a tech', () => {
    const r = parseDraft({
      version: 1,
      job: {
        ...jobAnswers,
        techs: [{ code: 'typescript', rating: 5, starred: true }],
      },
    });
    expect(r?.job?.techs).toEqual([{ code: 'typescript', rating: 5 }]);
  });

  it('is null when an answer has the wrong shape', () => {
    expect(
      parseDraft({ version: 1, job: { ...jobAnswers, techs: 'typescript' } }),
    ).toBeNull();
  });
});

describe('parseNewProfileDraft', () => {
  const ids = { newProfileId: BERLIN, copyFrom: null };

  it('reads a version 2 draft', () => {
    expect(
      parseNewProfileDraft({ version: 2, ...ids, job: jobAnswers, terms }),
    ).toEqual({ version: 2, ...ids, job: jobAnswers, terms });
    expect(parseNewProfileDraft({ version: 2, ...ids })).toEqual({
      version: 2,
      ...ids,
    });
    expect(
      parseNewProfileDraft({
        version: 2,
        newProfileId: BERLIN,
        copyFrom: BERLIN,
      }),
    ).toMatchObject({ copyFrom: BERLIN });
  });

  it('is null for a version 1 draft, and parseDraft is null for version 2', () => {
    expect(parseNewProfileDraft({ version: 1, job: jobAnswers })).toBeNull();
    expect(parseDraft({ version: 2, ...ids })).toBeNull();
  });

  it('is null for a bad uuid or a missing id', () => {
    expect(
      parseNewProfileDraft({
        version: 2,
        newProfileId: 'nope',
        copyFrom: null,
      }),
    ).toBeNull();
    expect(
      parseNewProfileDraft({ version: 2, newProfileId: BERLIN, copyFrom: 'x' }),
    ).toBeNull();
    expect(parseNewProfileDraft({ version: 2, copyFrom: null })).toBeNull();
  });

  it('drops worldwide rows', () => {
    const emea = {
      place: { kind: 'region', code: 'EMEA' },
      remote: true,
      hybrid: false,
      onsite: false,
    };
    const worldwide = { ...emea, place: { kind: 'worldwide' } };
    expect(
      parseNewProfileDraft({
        version: 2,
        ...ids,
        terms: { ...terms, places: [worldwide, emea] },
      })?.terms?.places,
    ).toEqual([emea]);
  });

  it('is null when an answer has the wrong shape', () => {
    expect(
      parseNewProfileDraft({
        version: 2,
        ...ids,
        job: { ...jobAnswers, techs: 'x' },
      }),
    ).toBeNull();
  });
});
