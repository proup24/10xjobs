import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import { postRecipes } from '../posts';
import { toRecipe } from '../builders';
import type { QuerySearchProfileInput } from '../types';
import { PrismaQuerySearchRepository } from './queries.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;

const input: QuerySearchProfileInput = {
  position: 'backend_engineer',
  seniorities: ['senior'],
  languages: ['en'],
  locations: { remote: ['EMEA'], hybrid: [], onsite: [] },
  skills: [
    {
      technology: 'nestjs',
      domain: SkillDomain.backend,
      importance: 9,
      mastery: 8,
    },
  ],
};

describe.skipIf(!url)('query search repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaQuerySearchRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  async function profile(): Promise<string> {
    const userId = randomUUID();
    await db.execute(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`
        .affectedCount()
        .build(),
    );
    const row = await db.orm.public.Profile.create({
      userId,
      position: 'backend_engineer',
      yearsOfExperience: 6,
      timezoneCurrent: 60,
      timezoneMin: -60,
      timezoneMax: 180,
      engagements: ['employee'],
      seniorities: ['senior'],
      noticePeriodDays: 30,
      contractTypes: ['full_time'],
      locations: {
        remote: [{ kind: 'region', code: 'EMEA' }],
        hybrid: [],
        onsite: [],
      },
      languages: [{ lang: 'en', level: 'fluent' }],
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
      state: 'published',
      publishedAt: new Date(),
    } as never);
    return row.id;
  }

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/processor_test'
    )
      throw new Error('Use a disposable localhost processor_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaQuerySearchRepository({ db } as DatabaseService);
    await sql`INSERT INTO iso_languages (code, label) VALUES ('en', 'English'), ('fr', 'French') ON CONFLICT (code) DO NOTHING`;
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE query_search_builder, profiles CASCADE`;
  });

  it("detachChannel drops only that channel's links and counts", async () => {
    const [first, second] = [await profile(), await profile()];
    const board = [
      toRecipe({
        channel: Channel.ASHBY,
        position: input.position,
        location: 'emea',
        experience: 'senior',
        type: Arrangement.remote,
        technologies: ['nestjs'],
        domain: SkillDomain.backend,
        languages: input.languages,
      }),
    ];
    const posts = postRecipes(input);
    expect(posts).toHaveLength(1);
    await repo.attach(first, [...board, ...posts]);
    await repo.attach(second, posts);

    expect(await repo.detachChannel(first, Channel.LINKEDIN_POSTS)).toBe(1);
    expect(await repo.detachChannel(first, Channel.LINKEDIN_POSTS)).toBe(0);

    const rows = await db.orm.public.QuerySearchBuilder.all();
    const byChannel = (channel: Channel) =>
      rows.find((row) => row.channel === channel)!;
    // The other profile still uses the post builder; the board link stays.
    expect(byChannel(Channel.LINKEDIN_POSTS)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
    expect(byChannel(Channel.ASHBY)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
    const links = await db.orm.public.ProfileQuerySearchBuilder.where({
      profileId: first,
    }).all();
    expect(links).toHaveLength(1);

    expect(await repo.detachChannel(second, Channel.LINKEDIN_POSTS)).toBe(1);
    expect(
      (await db.orm.public.QuerySearchBuilder.all()).find(
        (row) => row.channel === Channel.LINKEDIN_POSTS,
      ),
    ).toMatchObject({ associatedProfiles: 0, isActive: false });
  });
});
