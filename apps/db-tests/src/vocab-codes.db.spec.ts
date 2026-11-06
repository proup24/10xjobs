import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { profileFields, seedProfile } from './support/fixtures.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const CHECK_VIOLATION = '23514';

function expectCheckViolation(error: PostgrestError | null, field: string) {
  expect(error?.code).toBe(CHECK_VIOLATION);
  expect(error?.message).toContain(field);
}

/** A valid draft with the new preference fields set. */
const draft = () => ({
  ...profileFields(),
  contractTypes: ['full_time', 'contract'],
  places: {
    remote: [
      { kind: 'worldwide' },
      { kind: 'region', code: 'EMEA' },
      { kind: 'country', code: 'MA' },
    ],
    hybrid: [],
    onsite: [],
  },
  spokenLanguages: [{ lang: 'en', level: 'fluent' }],
  salaryMin: 3000,
  salaryCurrency: 'EUR',
  salaryPeriod: 'month',
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR', 'USD'],
});

describe('profile codes are checked against the value lists', () => {
  let a: TestUser;
  let proposedTech: string;
  let countryPlaces: { kind: 'country'; code: string }[];
  const approvedCityId = randomUUID();
  const approvedCityKey = `db-test-city-${randomUUID()}`;

  const insertProfile = (overrides: Record<string, unknown>) =>
    a.client
      .from('profiles')
      .insert({ id: randomUUID(), userId: a.id, ...draft(), ...overrides });

  beforeAll(async () => {
    a = await createTestUser();

    proposedTech = `proposed-${randomUUID()}`;
    const { error } = await admin().from('tech_tags').insert({
      code: proposedTech,
      label: proposedTech,
      aliases: [],
      status: 'proposed',
      firstSeenAt: new Date().toISOString(),
      implies: [],
    });
    if (error) throw new Error(error.message);

    const countries = await admin()
      .from('countries')
      .select('code')
      .eq('status', 'approved')
      .order('code')
      .limit(21);
    if (countries.error) throw new Error(countries.error.message);
    countryPlaces = countries.data.map(({ code }) => ({
      kind: 'country' as const,
      code: code as string,
    }));
    expect(countryPlaces).toHaveLength(21);

    // Cities are not pre-seeded: seed one approved city for the city-place cases.
    const city = await admin()
      .from('cities')
      .insert({
        id: approvedCityId,
        name: approvedCityKey,
        nameKey: approvedCityKey,
        countryCode: 'MA',
        aliases: [],
        status: 'approved',
        firstSeenAt: new Date().toISOString(),
      });
    if (city.error) throw new Error(city.error.message);
  });

  afterAll(async () => {
    await admin().from('tech_tags').delete().eq('code', proposedTech);
    await admin().from('cities').delete().eq('id', approvedCityId);
  });

  it('accepts a full valid profile and reads it back unchanged', async () => {
    const id = randomUUID();
    const { error } = await a.client
      .from('profiles')
      .insert({ id, userId: a.id, ...draft() });
    expect(error).toBeNull();

    const { data, error: readError } = await a.client
      .from('profiles')
      .select(
        'contractTypes, places, spokenLanguages, salaryMin, salaryCurrency, salaryPeriod, acceptsAnyCurrency, acceptedCurrencies',
      )
      .eq('id', id)
      .single();
    expect(readError).toBeNull();
    const {
      contractTypes,
      places,
      spokenLanguages,
      salaryMin,
      salaryCurrency,
      salaryPeriod,
      acceptsAnyCurrency,
      acceptedCurrencies,
    } = draft();
    expect(data).toEqual({
      contractTypes,
      places,
      spokenLanguages,
      salaryMin,
      salaryCurrency,
      salaryPeriod,
      acceptsAnyCurrency,
      acceptedCurrencies,
    });
  });

  it('refuses a proposed technology in a skill', async () => {
    const profileId = await seedProfile(a.id);
    const { error } = await a.client.from('profile_skills').insert({
      id: randomUUID(),
      userId: a.id,
      profileId,
      technology: proposedTech,
      domain: 'backend',
      mastery: 5,
    });
    expectCheckViolation(error, 'profile_skills.technology');
  });

  it.each<[string, () => Record<string, unknown>, string]>([
    [
      'non-engineering role',
      () => ({ position: 'support' }),
      'profiles.position',
    ],
    [
      'unstated seniority',
      () => ({ seniorities: ['unstated'] }),
      'profiles.seniorities',
    ],
    [
      'unknown contract type',
      () => ({ contractTypes: ['gig'] }),
      'profiles.contractTypes',
    ],
    [
      'unstated engagement',
      () => ({ engagements: ['unstated'] }),
      'profiles.engagements',
    ],
    [
      'unknown country place',
      () => ({
        places: {
          remote: [{ kind: 'country', code: 'ZZ' }],
          hybrid: [],
          onsite: [],
        },
      }),
      'profiles.places',
    ],
    [
      'GLOBAL region',
      () => ({
        places: {
          remote: [{ kind: 'region', code: 'GLOBAL' }],
          hybrid: [],
          onsite: [],
        },
      }),
      'profiles.places',
    ],
    [
      'unknown city id',
      () => ({
        places: {
          remote: [],
          hybrid: [],
          onsite: [{ kind: 'city', id: randomUUID() }],
        },
      }),
      'profiles.places',
    ],
    [
      'malformed city id',
      () => ({
        places: {
          remote: [],
          hybrid: [],
          onsite: [{ kind: 'city', id: 'not-a-uuid' }],
        },
      }),
      'profiles.places',
    ],
    [
      '21 places',
      () => ({ places: { remote: countryPlaces, hybrid: [], onsite: [] } }),
      'profiles.places',
    ],
    [
      'duplicate place',
      () => ({
        places: {
          remote: [
            { kind: 'country', code: 'MA' },
            { kind: 'country', code: 'MA' },
          ],
          hybrid: [],
          onsite: [],
        },
      }),
      'profiles.places',
    ],
    [
      'scalar place',
      () => ({ places: { remote: ['MA'], hybrid: [], onsite: [] } }),
      'profiles.places',
    ],
    [
      'null place',
      () => ({ places: { remote: [null], hybrid: [], onsite: [] } }),
      'profiles.places',
    ],
    [
      'unknown place kind',
      () => ({
        places: { remote: [{ kind: 'planet' }], hybrid: [], onsite: [] },
      }),
      'profiles.places',
    ],
    [
      'missing arrangement',
      () => ({ places: { remote: [], hybrid: [] } }),
      'profiles.places',
    ],
    [
      'bad language',
      () => ({ spokenLanguages: [{ lang: 'xx', level: 'fluent' }] }),
      'profiles.spokenLanguages',
    ],
    [
      'bad level',
      () => ({ spokenLanguages: [{ lang: 'en', level: 'basic' }] }),
      'profiles.spokenLanguages',
    ],
    [
      'duplicate language',
      () => ({
        spokenLanguages: [
          { lang: 'en', level: 'fluent' },
          { lang: 'en', level: 'native' },
        ],
      }),
      'profiles.spokenLanguages',
    ],
    [
      'no languages',
      () => ({ spokenLanguages: [] }),
      'profiles.spokenLanguages',
    ],
    [
      'bad currency',
      () => ({
        salaryMin: 5000,
        salaryCurrency: 'EURO',
        salaryPeriod: 'month',
      }),
      'profiles.salaryCurrency',
    ],
    [
      'bad accepted currency',
      () => ({ acceptsAnyCurrency: false, acceptedCurrencies: ['EURO'] }),
      'profiles.acceptedCurrencies',
    ],
  ])('refuses %s', async (_case, override, field) => {
    const { error } = await insertProfile(override());
    expectCheckViolation(error, field);
  });

  it('names the bad code in the message', async () => {
    const { error } = await insertProfile({ contractTypes: ['gig'] });
    expect(error?.message).toBe(
      "profiles.contractTypes: 'gig' is not an approved contract_types code",
    );
  });

  it('says a profile uses worldwide instead of the GLOBAL region', async () => {
    const { error } = await insertProfile({
      places: {
        remote: [{ kind: 'region', code: 'GLOBAL' }],
        hybrid: [],
        onsite: [],
      },
    });
    expectCheckViolation(error, "profiles.places: 'GLOBAL'");
    expect(error?.message).toBe(
      "profiles.places: 'GLOBAL' is not allowed in a profile; use { kind: worldwide }",
    );
  });

  it('accepts an approved city, its id in any case', async () => {
    const { error } = await insertProfile({
      places: {
        remote: [],
        hybrid: [],
        onsite: [{ kind: 'city', id: approvedCityId.toUpperCase() }],
      },
    });
    expect(error).toBeNull();
  });

  it('refuses the same city twice when its id differs only in case', async () => {
    const { error } = await insertProfile({
      places: {
        remote: [],
        hybrid: [],
        onsite: [
          { kind: 'city', id: approvedCityId },
          { kind: 'city', id: approvedCityId.toUpperCase() },
        ],
      },
    });
    expectCheckViolation(error, 'profiles.places');
    expect(error?.message).toContain('more than once');
  });

  it.each<[string, Record<string, unknown>]>([
    ['assert_codes', { field: 'x', list: 'countries', codes: ['MA'] }],
    [
      'assert_places',
      { field: 'x', places: { remote: [], hybrid: [], onsite: [] } },
    ],
  ])('refuses a user calling %s directly', async (fn, args) => {
    const { error } = await a.client.rpc(fn as never, args as never);
    // EXECUTE is revoked from authenticated, so PostgREST's call fails in
    // Postgres with 42501 (permission denied for function).
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain(fn);
  });

  it('checks codes on update too', async () => {
    const id = randomUUID();
    expect((await insertProfile({ id })).error).toBeNull();
    const { error } = await a.client
      .from('profiles')
      .update({ contractTypes: ['gig'] })
      .eq('id', id);
    expectCheckViolation(error, 'profiles.contractTypes');
  });

  it('refuses a partial salary', async () => {
    const { error } = await insertProfile({
      salaryMin: 3000,
      salaryCurrency: null,
      salaryPeriod: 'month',
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
    // PostgREST passes Postgres's message through: 'new row for relation
    // "profiles" violates check constraint "<name>_<hash>"'.
    expect(error?.message).toContain('profiles_salary_all_or_none');
  });

  it('refuses currency "any" with a list', async () => {
    const { error } = await insertProfile({
      acceptsAnyCurrency: true,
      acceptedCurrencies: ['EUR'],
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('profiles_currencies_any_xor_list');
  });

  it('refuses currency "not any" with an empty list', async () => {
    const { error } = await insertProfile({
      acceptsAnyCurrency: false,
      acceptedCurrencies: [],
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('profiles_currencies_any_xor_list');
  });

  it('accepts a profile written the old way, without the new columns', async () => {
    const { error } = await a.client
      .from('profiles')
      .insert({ id: randomUUID(), userId: a.id, ...profileFields() });
    expect(error).toBeNull();
  });

  it('accepts a profile with no salary and any currency', async () => {
    const { error } = await insertProfile({
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
    });
    expect(error).toBeNull();
  });
});
