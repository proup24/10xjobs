// Runs against a live engine and the local Supabase stack: `nx run web:test-live`.
// Lives outside src/ so the service-role guard in src/ keeps scanning only what the app ships.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngineClient } from '../src/lib/engine/client';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `The live test needs ${name} (locally: eval "$(scripts/supabase-env.sh)" and set ENGINE_URL and ENGINE_API_KEY).`,
    );
  }
  return value;
}

function adminClient(url: string, key: string): SupabaseClient {
  // The test creates and deletes auth users: never against a remote project.
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(
      `The live test creates and deletes auth users: refusing non-local SUPABASE_URL ${new URL(url).hostname}.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe('engine client against the running engine', () => {
  const engineUrl = requireEnv('ENGINE_URL');
  const apiKey = requireEnv('ENGINE_API_KEY');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = requireEnv('SUPABASE_PUBLISHABLE_KEY');

  const admin = adminClient(supabaseUrl, serviceKey);
  let userId: string;
  let profileId: string;
  let accessToken: string;

  const engine = () =>
    createEngineClient({
      url: engineUrl,
      apiKey,
      accessToken: async () => accessToken,
      log: () => undefined,
    });

  beforeAll(async () => {
    const email = `web-live-${randomUUID()}@xjobs.test`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`Could not create auth user: ${created.error?.message}`);
    }
    userId = created.data.user.id;

    const anon = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await anon.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw new Error(
        `Could not sign in: ${signedIn.error?.message ?? 'no session'}`,
      );
    }
    accessToken = signedIn.data.session.access_token;

    const eligibility = await admin
      .from('users')
      .update({ residenceCountry: 'MA', acceptsSponsorship: false })
      .eq('id', userId);
    if (eligibility.error) {
      throw new Error(
        `Could not set eligibility: ${eligibility.error.message}`,
      );
    }

    profileId = randomUUID();
    const profile = await admin.from('profiles').insert({
      id: profileId,
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
    if (profile.error) {
      throw new Error(`Could not insert profile: ${profile.error.message}`);
    }
    const skills = await admin.from('profile_skills').insert(
      [
        { technology: 'nodejs', mastery: 8, importance: 9 },
        { technology: 'typescript', mastery: 8, importance: 8 },
      ].map((skill) => ({
        id: randomUUID(),
        profileId,
        userId,
        domain: 'backend',
        ...skill,
      })),
    );
    if (skills.error) {
      throw new Error(`Could not insert skills: ${skills.error.message}`);
    }
  });

  afterAll(async () => {
    if (!userId) return;
    // Deleting the auth user cascades to its users row and profiles.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Could not delete auth user: ${error.message}`);
    }
  });

  it("publishes the signed-in user's draft through the running engine", async () => {
    const result = await engine().publishProfile(profileId);
    expect(result).toEqual({
      kind: 'ok',
      data: expect.objectContaining({ id: profileId, state: 'published' }),
    });
  });

  it('a second publish is conflict/already-published', async () => {
    const result = await engine().publishProfile(profileId);
    expect(result).toEqual({ kind: 'conflict', reason: 'already-published' });
  });
});
