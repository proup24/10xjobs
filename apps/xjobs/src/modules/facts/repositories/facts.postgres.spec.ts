import { randomUUID } from 'node:crypto';
import {
  createDatabaseClient,
  type DatabaseClient,
  processorListsSeed,
} from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import type { SeedEnvironmentVariables } from 'src/config';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { combineFacts } from '../rules/combine';
import { listingFacts } from '../rules/listing';
import { hashFacts } from '../services/facts.service';
import { FACTS_VERSION } from '../config/facts.config';
import { PrismaFactsRepository, type SavedFacts } from './facts.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');

describe.skipIf(!url)('facts repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaFactsRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  async function job(
    over: { countryCode?: string; contractType?: string } = {},
  ) {
    const row = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: 'active',
      mergedIntoId: null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      location: 'Paris, France',
      contractType: over.contractType ?? 'Full-time',
      experienceLevel: 'Mid-Senior level',
      salaryText: null,
      salaryMin: 50000,
      salaryMax: 60000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'YEAR',
      salaryProvidedByEmployer: true,
      workplaceType: 'onsite',
      countryCode: over.countryCode ?? 'FR',
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: t0,
      processingStatus: 'processed',
      processingReason: null,
      processingRequestedAt: t0,
      normalizerVersion: 1,
    });
    const ex = await db.orm.public.JobExtraction.create({
      jobId: row.id,
      inputHash: randomUUID(),
      schemaVersion: 3,
      promptHash: 'p',
      decisionModel: 'd',
      extractionModel: 'e',
      data: fixtureDocument() as never,
      needsReview: false,
      arrangement: null,
      seniority: null,
      roleKind: null,
      contractType: null,
      engagement: null,
      isSoftwareEngineeringRole: null,
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      requiredTags: [],
      niceTags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      costUsd: '0',
    });
    await db.orm.public.NormalizedJob.where({ id: row.id }).updateAll({
      currentExtractionId: ex.id,
    });
    return { jobId: row.id, extractionId: ex.id };
  }

  function saved(
    j: { jobId: string; extractionId: string },
    conflictFields: Array<'arrangement' | 'salary'> = [],
  ): SavedFacts {
    const vocab = {
      regions: new Set(['EMEA']),
      countries: new Set(['FR']),
      cities: new Map(),
      countryNames: new Map(),
      cityCountries: new Map(),
      cityNames: new Map(),
      regionCountries: new Map([['EMEA', new Set(['FR'])]]),
    };
    const { facts } = combineFacts({
      extraction: fixtureDocument(),
      listing: listingFacts(
        {
          workplaceType: null,
          countryCode: null,
          regionCode: null,
          city: null,
          geoId: null,
          location: null,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
          salaryProvidedByEmployer: null,
          experienceLevel: null,
          contractType: null,
          expiresAt: null,
        },
        vocab,
      ),
      vocab,
      now: t0,
      descriptionText: null,
    });
    return {
      ...j,
      builtAt: t0,
      factsVersion: FACTS_VERSION,
      factsHash: hashFacts(facts),
      facts,
      closed: false,
      conflicts: conflictFields.map((field) => ({
        field,
        listingValue: 'a',
        descriptionValue: 'b',
        quote: 'q',
        winner: 'description' as const,
      })),
    };
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
    repo = new PrismaFactsRepository({ db } as DatabaseService);
    await sql`TRUNCATE processing_attempts, job_extractions, cities, region_countries, tech_tags, regions, countries, role_kinds, seniorities, arrangements, contract_types, engagements, junk_flags CASCADE`;
    await db.transaction((tx) =>
      processorListsSeed.run(tx, {} as SeedEnvironmentVariables),
    );
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE job_fact_conflicts, job_facts, job_matches, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs CASCADE`;
  });

  it('loadInputs selects the listing columns, including contractType', async () => {
    const j = await job();
    const inputs = await repo.loadInputs(j.jobId);
    expect(inputs).toMatchObject({
      extractionId: j.extractionId,
      schemaVersion: 3,
      descriptionText: 'We build things.',
      listing: {
        workplaceType: 'onsite',
        countryCode: 'FR',
        contractType: 'Full-time',
        salaryMin: 50000,
        salaryProvidedByEmployer: true,
      },
    });
    const [{ updatedAt }] = await db.query(
      db.raw
        .sql`SELECT "updatedAt" FROM normalized_jobs WHERE id = ${j.jobId}::uuid`
        .returnsRow({ updatedAt: 'pg/timestamptz-date@1' })
        .build(),
    );
    expect(inputs?.jobUpdatedAt).toEqual(updatedAt);
  });

  it('save stores the given builtAt, not the time of the save', async () => {
    const j = await job();
    const builtAt = new Date('2026-10-01T10:00:00.123Z');
    await repo.save({ ...saved(j), builtAt });
    const [row] = await db.query(
      db.raw
        .sql`SELECT "builtAt" FROM job_facts WHERE "jobId" = ${j.jobId}::uuid`
        .returnsRow({ builtAt: 'pg/timestamptz-date@1' })
        .build(),
    );
    expect(row.builtAt).toEqual(builtAt);
  });

  it('loadInputs returns null without a current extraction', async () => {
    const j = await job();
    await db.execute(
      db.raw
        .sql`UPDATE normalized_jobs SET "currentExtractionId" = NULL WHERE id = ${j.jobId}::uuid`
        .affectedCount()
        .build(),
    );
    expect(await repo.loadInputs(j.jobId)).toBeNull();
  });

  it('facts saved as of the load are current; a job change after the load leaves them stale', async () => {
    const j = await job();
    const stale = async () => {
      const [row] = await db.query(
        db.raw.sql`SELECT j."updatedAt" > f."builtAt" AS stale
          FROM normalized_jobs j JOIN job_facts f ON f."jobId" = j.id
          WHERE j.id = ${j.jobId}::uuid`
          .returnsRow({ stale: 'pg/bool@1' })
          .build(),
      );
      return row.stale;
    };
    const inputs = await repo.loadInputs(j.jobId);
    await repo.save({ ...saved(j), builtAt: inputs!.jobUpdatedAt });
    expect(await stale()).toBe(false);

    const again = await repo.loadInputs(j.jobId);
    // An ingest write lands between the load and the save.
    await db.execute(
      db.raw
        .sql`UPDATE normalized_jobs SET "updatedAt" = now() + interval '1 second' WHERE id = ${j.jobId}::uuid`
        .affectedCount()
        .build(),
    );
    await repo.save({ ...saved(j), builtAt: again!.jobUpdatedAt });
    expect(await stale()).toBe(true);
  });

  it('save then current round-trips', async () => {
    const j = await job();
    expect(await repo.current(j.jobId)).toBeNull();
    const row = saved(j);
    await repo.save(row);
    expect(await repo.current(j.jobId)).toEqual({
      factsHash: row.factsHash,
      factsVersion: FACTS_VERSION,
    });
  });

  it('conflicts are replaced, not appended', async () => {
    const j = await job();
    await repo.save(saved(j, ['arrangement', 'salary']));
    await repo.save(saved(j, ['salary']));
    const rows = await db.orm.public.JobFactConflict.where({
      jobId: j.jobId,
    }).all();
    expect(rows.map((r) => r.field)).toEqual(['salary']);
  });

  it('markStale also marks a job whose country appears only in its description places', async () => {
    const city = await job({ countryCode: 'DE' });
    const country = await job({ countryCode: 'DE' });
    const elsewhere = await job({ countryCode: 'DE' });
    for (const j of [city, country, elsewhere]) await repo.save(saved(j));
    const places = async (
      j: { jobId: string },
      list: Record<string, unknown>[],
    ) =>
      db.execute(
        db.raw.sql`UPDATE job_facts SET facts = jsonb_set(facts, '{openings}',
            jsonb_build_array(jsonb_set(facts->'openings'->0, '{places}', ${JSON.stringify(list)}::jsonb)))
          WHERE "jobId" = ${j.jobId}::uuid`
          .affectedCount()
          .build(),
      );
    await places(city, [
      { kind: 'city', name: 'Lyon', countryCode: 'FR', cityId: null },
    ]);
    await places(country, [{ kind: 'country', code: 'FR' }]);
    await places(elsewhere, [
      { kind: 'city', name: 'Berlin', countryCode: 'DE', cityId: null },
      { kind: 'region', code: 'EMEA' },
    ]);
    expect(await repo.markStale({ countryCode: 'FR' })).toBe(2);
    const stale = await db.query(
      db.raw.sql`SELECT "jobId" FROM job_facts WHERE "builtAt" = '-infinity'`
        .returnsRow({ jobId: 'pg/uuid@1' })
        .build(),
    );
    expect(stale.map((r) => r.jobId).sort()).toEqual(
      [city.jobId, country.jobId].sort(),
    );
  });

  it('markStale sets builtAt to -infinity for the country only', async () => {
    const fr = await job({ countryCode: 'FR' });
    const de = await job({ countryCode: 'DE' });
    await repo.save(saved(fr));
    await repo.save(saved(de));
    expect(await repo.markStale({ countryCode: 'FR' })).toBe(1);
    const stale = await db.query(
      db.raw.sql`SELECT "jobId" FROM job_facts WHERE "builtAt" = '-infinity'`
        .returnsRow({ jobId: 'pg/uuid@1' })
        .build(),
    );
    expect(stale.map((r) => r.jobId)).toEqual([fr.jobId]);
  });
});
