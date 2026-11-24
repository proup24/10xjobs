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
  // A second pool, so a test can hold a lock on one connection and act on another.
  let db2: DatabaseClient;
  let repo: PrismaQuerySearchRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  /** Runs one fixed statement with no parameters, such as DDL naming a test id. */
  async function ddl(text: string): Promise<void> {
    const statement = Object.assign([text], { raw: [text] });
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  /** The SQLSTATE in `error`'s cause chain, if any. */
  function sqlStateOf(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 10 && current; depth++) {
      if (typeof current !== 'object') return undefined;
      const state = (current as { sqlState?: unknown }).sqlState;
      if (typeof state === 'string') return state;
      current = (current as { cause?: unknown }).cause;
    }
    return undefined;
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

  async function draftOf(id: string): Promise<void> {
    await db.execute(
      db.raw
        .sql`UPDATE profiles SET state = 'draft', "publishedAt" = NULL WHERE id = ${id}::uuid`
        .affectedCount()
        .build(),
    );
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
    db2 = createDatabaseClient({
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
    await db2?.close();
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

  const ashby = (location: string) =>
    toRecipe({
      channel: Channel.ASHBY,
      position: input.position,
      location,
      experience: 'senior',
      type: Arrangement.remote,
      technologies: ['nestjs'],
      domain: SkillDomain.backend,
      languages: input.languages,
    });

  async function builderOf(recipe: { hash: string }) {
    return db.orm.public.QuerySearchBuilder.where({
      hash: recipe.hash,
    }).first();
  }

  it('replace keeps shared builders linked throughout', async () => {
    const id = await profile();
    const [a, b, c] = [ashby('emea'), ashby('paris'), ashby('berlin')];
    await repo.attach(id, [a, b]);

    const result = await repo.replace(id, [b, c], {
      searchesVersion: 3,
      switches: { postSearch: false, indeedSearch: false },
    });

    expect(result).toEqual({
      created: 1,
      existing: 1,
      released: 1,
      skipped: null,
    });
    const links = await db.orm.public.ProfileQuerySearchBuilder.where({
      profileId: id,
    }).all();
    const linked = new Set(links.map((link) => link.queryId));
    const [ra, rb, rc] = [
      await builderOf(a),
      await builderOf(b),
      await builderOf(c),
    ];
    expect(linked).toEqual(new Set([rb!.id, rc!.id]));
    expect(ra).toMatchObject({ associatedProfiles: 0, isActive: false });
    expect(rb).toMatchObject({ associatedProfiles: 1, isActive: true });
    expect(rc).toMatchObject({ associatedProfiles: 1, isActive: true });
  });

  it('replace on a draft changes nothing', async () => {
    const id = await profile();
    const a = ashby('emea');
    await draftOf(id);

    expect(
      await repo.replace(id, [a], {
        searchesVersion: 5,
        switches: { postSearch: false, indeedSearch: false },
      }),
    ).toEqual({
      created: 0,
      existing: 0,
      released: 0,
      skipped: 'not_published',
    });

    expect(await builderOf(a)).toBeNull();
    expect(
      await db.orm.public.ProfileQuerySearchBuilder.where({
        profileId: id,
      }).all(),
    ).toHaveLength(0);
    expect(
      (await db.orm.public.Profile.where({ id }).first())!.searchesVersion,
    ).toBeNull();
  });

  it('replace sets searchesVersion', async () => {
    const id = await profile();
    await repo.replace(id, [ashby('emea')], {
      searchesVersion: 7,
      switches: { postSearch: false, indeedSearch: false },
    });
    expect(
      (await db.orm.public.Profile.where({ id }).first())!.searchesVersion,
    ).toBe(7);
  });

  it('replace with the same recipes changes no counts', async () => {
    const [id, other] = [await profile(), await profile()];
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a, b]);
    await repo.attach(other, [a]);

    const result = await repo.replace(id, [a, b], {
      searchesVersion: 2,
      switches: { postSearch: false, indeedSearch: false },
    });

    expect(result.released).toBe(0);
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 2,
      isActive: true,
    });
    expect(await builderOf(b)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
  });

  it('replace with a stale post search changes nothing', async () => {
    const [id, other] = [await profile(), await profile()];
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a]);
    await repo.attach(other, [a]);
    // The switch was turned on after the caller built its recipes.
    await db.execute(
      db.raw.sql`UPDATE profiles SET "postSearch" = true WHERE id = ${id}::uuid`
        .affectedCount()
        .build(),
    );

    expect(
      await repo.replace(id, [b], {
        searchesVersion: 4,
        switches: { postSearch: false, indeedSearch: false },
      }),
    ).toEqual({
      created: 0,
      existing: 0,
      released: 0,
      skipped: 'switch_changed',
    });

    expect(await builderOf(b)).toBeNull();
    const links = await db.orm.public.ProfileQuerySearchBuilder.where({
      profileId: id,
    }).all();
    expect(links.map((link) => link.queryId)).toEqual([
      (await builderOf(a))!.id,
    ]);
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 2,
      isActive: true,
    });
    expect(
      (await db.orm.public.Profile.where({ id }).first())!.searchesVersion,
    ).toBeNull();
  });

  it('skips when indeedSearch moved since the read', async () => {
    const id = await profile();
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a]);
    // Read with both switches off; Indeed was turned on before the swap.
    await db.execute(
      db.raw
        .sql`UPDATE profiles SET "indeedSearch" = true WHERE id = ${id}::uuid`
        .affectedCount()
        .build(),
    );

    expect(
      await repo.replace(id, [b], {
        searchesVersion: 4,
        switches: { postSearch: false, indeedSearch: false },
      }),
    ).toEqual({
      created: 0,
      existing: 0,
      released: 0,
      skipped: 'switch_changed',
    });

    expect(await builderOf(b)).toBeNull();
    const links = await db.orm.public.ProfileQuerySearchBuilder.where({
      profileId: id,
    }).all();
    expect(links.map((link) => link.queryId)).toEqual([
      (await builderOf(a))!.id,
    ]);
    expect(
      (await db.orm.public.Profile.where({ id }).first())!.searchesVersion,
    ).toBeNull();
  });

  it('an indeedSearch change during a swap rolls the swap back', async () => {
    const id = await profile();
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a]);
    const suffix = id.replaceAll('-', '');
    const fn = `test_flip_indeed_search_${suffix}`;
    const trigger = `test_flip_indeed_search_${suffix}`;
    // The switch flips the flag inside the swap, after its early check.
    await ddl(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."profileId" = '${id}'::uuid THEN
          UPDATE profiles SET "indeedSearch" = NOT "indeedSearch" WHERE id = NEW."profileId";
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await ddl(
        `CREATE TRIGGER ${trigger} AFTER INSERT ON profile_query_search_builders FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      expect(
        await repo.replace(id, [b], {
          searchesVersion: 4,
          switches: { postSearch: false, indeedSearch: false },
        }),
      ).toMatchObject({ skipped: 'switch_changed' });
    } finally {
      await ddl(
        `DROP TRIGGER IF EXISTS ${trigger} ON profile_query_search_builders`,
      );
      await ddl(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect(await builderOf(b)).toBeNull();
    const row = (await db.orm.public.Profile.where({ id }).first())!;
    expect(row.searchesVersion).toBeNull();
    expect(row.indeedSearch).toBe(false);
  });

  it('a running swap does not block an edit of the profile', async () => {
    const id = await profile();
    await db.transaction(async (tx) => {
      // The lock replace holds on the profile for the whole swap.
      expect(
        await PrismaQuerySearchRepository['lockForSwap'](tx, id),
      ).not.toBeNull();

      // A user's edit (PostgREST PATCH) takes FOR NO KEY UPDATE: it must not wait.
      await db2.transaction(async (other) => {
        await other.execute(
          other.raw.sql`SET LOCAL lock_timeout = '500ms'`
            .affectedCount()
            .build(),
        );
        await other.execute(
          other.raw
            .sql`UPDATE profiles SET "noticePeriodDays" = 60 WHERE id = ${id}::uuid`
            .affectedCount()
            .build(),
        );
      });

      // A delete must still wait, so a swapped profile never loses links unadjusted.
      const deleting = db2.transaction(async (other) => {
        await other.execute(
          other.raw.sql`SET LOCAL lock_timeout = '500ms'`
            .affectedCount()
            .build(),
        );
        await other.execute(
          other.raw.sql`DELETE FROM profiles WHERE id = ${id}::uuid`
            .affectedCount()
            .build(),
        );
      });
      const error = await deleting.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(['55P03', '57014']).toContain(sqlStateOf(error));
    });
    expect(
      (await db.orm.public.Profile.where({ id }).first())!.noticePeriodDays,
    ).toBe(60);
  });

  it('a postSearch change during a swap rolls the swap back', async () => {
    const [id, other] = [await profile(), await profile()];
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a]);
    await repo.attach(other, [a]);
    const suffix = id.replaceAll('-', '');
    const fn = `test_flip_post_search_${suffix}`;
    const trigger = `test_flip_post_search_${suffix}`;
    // The switch flips the flag inside the swap, after its early check.
    await ddl(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."profileId" = '${id}'::uuid THEN
          UPDATE profiles SET "postSearch" = NOT "postSearch" WHERE id = NEW."profileId";
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await ddl(
        `CREATE TRIGGER ${trigger} AFTER INSERT ON profile_query_search_builders FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );

      expect(
        await repo.replace(id, [b], {
          searchesVersion: 4,
          switches: { postSearch: false, indeedSearch: false },
        }),
      ).toEqual({
        created: 0,
        existing: 0,
        released: 0,
        skipped: 'switch_changed',
      });
    } finally {
      await ddl(
        `DROP TRIGGER IF EXISTS ${trigger} ON profile_query_search_builders`,
      );
      await ddl(`DROP FUNCTION IF EXISTS ${fn}()`);
    }

    expect(await builderOf(b)).toBeNull();
    const links = await db.orm.public.ProfileQuerySearchBuilder.where({
      profileId: id,
    }).all();
    expect(links.map((link) => link.queryId)).toEqual([
      (await builderOf(a))!.id,
    ]);
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 2,
      isActive: true,
    });
    const row = (await db.orm.public.Profile.where({ id }).first())!;
    expect(row.searchesVersion).toBeNull();
    expect(row.postSearch).toBe(false);
  });

  it('two overlapping swaps of one profile keep counts and links right', async () => {
    const id = await profile();
    const places = Array.from({ length: 12 }, (_, i) => `place-${i}`);
    const recipes = places.map(ashby);
    // Overlapping sets, so each swap both keeps, adds and drops builders.
    const first = recipes.slice(0, 8);
    const second = recipes.slice(4, 12);
    await repo.attach(id, recipes.slice(2, 10));
    // A second pool, so the two swaps really run on separate connections.
    const other = new PrismaQuerySearchRepository({
      db: db2,
    } as DatabaseService);

    for (let round = 0; round < 4; round++) {
      await Promise.all([
        repo.replace(id, round % 2 ? second : first, {
          searchesVersion: round,
          switches: { postSearch: false, indeedSearch: false },
        }),
        other.replace(id, round % 2 ? first : second, {
          searchesVersion: round,
          switches: { postSearch: false, indeedSearch: false },
        }),
      ]);

      const links = await db.orm.public.ProfileQuerySearchBuilder.where({
        profileId: id,
      }).all();
      const builders = await db.orm.public.QuerySearchBuilder.all();
      const hashById = new Map(builders.map((row) => [row.id, row.hash]));
      const linked = links.map((link) => hashById.get(link.queryId)).sort();
      expect([
        first.map((recipe) => recipe.hash).sort(),
        second.map((recipe) => recipe.hash).sort(),
      ]).toContainEqual(linked);
      for (const builder of builders) {
        const used = links.filter((link) => link.queryId === builder.id).length;
        expect(builder).toMatchObject({
          associatedProfiles: used,
          isActive: used > 0,
        });
      }
    }
  });

  it('a link another transaction deleted meanwhile is not released twice', async () => {
    const [id, other] = [await profile(), await profile()];
    const a = ashby('emea');
    await repo.attach(id, [a]);
    await repo.attach(other, [a]);
    const builder = (await builderOf(a))!;
    let detaching: Promise<number> | undefined;
    await db2.transaction(async (tx) => {
      // What an overlapping swap does: unlink the builder and count it down.
      await tx.execute(
        tx.raw
          .sql`DELETE FROM profile_query_search_builders WHERE "profileId" = ${id}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw
          .sql`UPDATE query_search_builder SET "associatedProfiles" = "associatedProfiles" - 1 WHERE id = ${builder.id}::uuid`
          .affectedCount()
          .build(),
      );
      // detach reads the link (still committed), then waits on its row lock.
      detaching = repo.detach(id);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(await detaching).toBe(0);
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
  });

  it('releaseAndDelete releases every builder and deletes the profile', async () => {
    const [id, other] = [await profile(), await profile()];
    const [a, b] = [ashby('emea'), ashby('paris')];
    await repo.attach(id, [a, b]);
    await repo.attach(other, [a]);

    expect(await repo.releaseAndDelete(id)).toBe(true);

    expect(await db.orm.public.Profile.where({ id }).first()).toBeNull();
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
    expect(await builderOf(b)).toMatchObject({
      associatedProfiles: 0,
      isActive: false,
    });
  });

  it('releaseAndDelete leaves a draft alone', async () => {
    const id = await profile();
    const a = ashby('emea');
    await repo.attach(id, [a]);
    await draftOf(id);

    expect(await repo.releaseAndDelete(id)).toBe(false);

    expect(await db.orm.public.Profile.where({ id }).first()).not.toBeNull();
    expect(await builderOf(a)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
    expect(
      await db.orm.public.ProfileQuerySearchBuilder.where({
        profileId: id,
      }).all(),
    ).toHaveLength(1);
  });
});
