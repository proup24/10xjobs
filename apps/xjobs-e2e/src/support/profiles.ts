import { randomUUID } from 'node:crypto';
import { admin } from './auth-users';

/** Inserts, through the service role, a draft profile that passes publish; returns its id. */
export async function createDraftProfile(userId: string): Promise<string> {
  const id = randomUUID();
  const db = admin();
  const { error } = await db.from('profiles').insert({
    id,
    userId,
    position: 'backend_engineer',
    languages: [
      { lang: 'en', level: 'fluent' },
      { lang: 'fr', level: 'native' },
    ],
    locations: {
      remote: [
        { kind: 'region', code: 'EMEA' },
        { kind: 'region', code: 'NORTH_AFRICA' },
      ],
      hybrid: [{ kind: 'country', code: 'MA' }],
      onsite: [],
    },
    yearsOfExperience: 6,
    timezoneCurrent: 60,
    timezoneMin: -240,
    timezoneMax: 240,
    engagements: ['employee', 'contractor'],
    seniorities: ['senior'],
    contractTypes: ['full_time', 'contract'],
    salaryMin: 4000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'month',
    acceptsAnyCurrency: false,
    acceptedCurrencies: ['EUR', 'MAD'],
    noticePeriodDays: 30,
    state: 'draft',
  });
  if (error) throw new Error(`Could not insert profile: ${error.message}`);
  const skills = await db.from('profile_skills').insert(
    [
      { technology: 'nodejs', mastery: 8, importance: 9 },
      { technology: 'typescript', mastery: 8, importance: 8 },
    ].map((skill) => ({
      id: randomUUID(),
      profileId: id,
      userId,
      domain: 'backend',
      ...skill,
    })),
  );
  if (skills.error)
    throw new Error(`Could not insert skills: ${skills.error.message}`);
  return id;
}

export async function profileState(id: string): Promise<string> {
  const { data, error } = await admin()
    .from('profiles')
    .select('state')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Could not read profile ${id}: ${error.message}`);
  return data.state;
}
