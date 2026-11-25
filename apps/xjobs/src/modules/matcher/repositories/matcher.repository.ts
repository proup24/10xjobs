import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import { FACTS_VERSION } from 'src/modules/facts/config/facts.config';
import { RatesRepository } from 'src/modules/rates';
import { linkedInJobIds } from 'src/modules/processor';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import { MATCH_BACKFILL_DAYS, MATCHER_VERSION } from '../config/matcher.config';
import type { Decision, MatchContext } from '../rules/decide';
import type {
  Check,
  MatchEligibility,
  MatchProfile,
  RuleName,
} from '../rules/types';

/** A decision as stored: one row per profile and job. */
export interface StoredMatch extends Decision {
  profileId: string;
  userId: string;
  jobId: string;
  extractionId: string;
  /** The hash of the `job_facts` the decision read; `''` on a row decided before job facts (never current). */
  factsHash: string;
  /** The profile's `matchVersion` the decision read; null on a row decided before it was recorded (stale). */
  profileVersion: number | null;
  /** The user's `eligibilityVersion` the decision read; null on a row decided before it was recorded. */
  eligibilityVersion: number | null;
}

/** What a current row was decided on: the job's facts and its current extraction. */
export interface StaleFor {
  jobId: string;
  factsHash: string;
  extractionId: string;
}

/** A matchable job's current extraction, which the facts are built from. */
export interface MatchCandidate {
  extractionId: string;
  needsReview: boolean;
}

/** Every read and write the matcher makes. */
export abstract class MatcherRepository {
  /** The job's current extraction when the job is matchable, else null. */
  abstract loadCandidate(jobId: string): Promise<MatchCandidate | null>;
  /**
   * Published profiles with skills. `onlyStaleFor`: only those whose row for that job is
   * missing, or has another factsHash, another extractionId, or an older matcherVersion,
   * or was decided before the profile's last edit or the user's last eligibility change.
   */
  abstract listPublishedProfiles(opts?: {
    onlyStaleFor?: StaleFor;
  }): Promise<MatchProfile[]>;
  abstract loadContext(): Promise<MatchContext>;
  /**
   * Stores the decisions. For each qualified row it also asks the database for a webhook
   * delivery, in the same transaction, and returns the ids of the deliveries created.
   */
  abstract upsertMatches(
    rows: StoredMatch[],
  ): Promise<{ deliveryIds: string[] }>;
  /**
   * Matchable jobs whose facts are stale (so building them may change them),
   * or whose open facts have a stale or missing row for a published profile.
   */
  abstract listStaleJobs(limit: number): Promise<string[]>;
  /** Every matchable job id (for db:rematch). */
  abstract listMatchableJobs(): Promise<string[]>;
  /** Deletes rows of jobs that are no longer status='active'; returns how many. */
  abstract deleteInactive(): Promise<number>;
  abstract matchesForJob(jobId: string): Promise<StoredMatch[]>;
}

type Raw = DatabaseTransaction['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';
const JSONB = 'pg/jsonb@1';

/**
 * What makes a job matchable, over `normalized_jobs j` joined with its
 * current extraction `e`: an active, processed, open LinkedIn job seen within
 * the backfill window, with a current-schema (v3) extraction.
 */
function matchable(raw: Raw) {
  return raw.sql`j.status = 'active' AND j.kind = 'job'
    AND j.id IN (${linkedInJobIds(raw)})
    AND j."processingStatus" = 'processed' AND NOT j.closed
    AND j."lastSeenAt" >= now() - make_interval(days => ${MATCH_BACKFILL_DAYS}::int)
    AND e."schemaVersion" = ${EXTRACTION_SCHEMA_VERSION}::int`.returns(BOOL);
}

/**
 * The job `j`'s `job_facts f` must be built again: missing, built from another
 * extraction or an older rule set, older than the job row, or open past expiry.
 */
const STALE_FACTS = (raw: Raw) =>
  raw.sql`(f."jobId" IS NULL
    OR f."extractionId" <> j."currentExtractionId"
    OR f."factsVersion" < ${FACTS_VERSION}::int
    OR j."updatedAt" > f."builtAt"
    OR (NOT f.closed AND j."expiresAt" <= now()))`.returns(BOOL);

/**
 * The row `m` (joined with its user `u`) was decided on the current state of the profile `p`
 * and of the user's eligibility. A null `profileVersion` is stale; a null `eligibilityVersion` is not by this
 * test: the MATCHER_VERSION bump that came with it already makes it stale.
 */
const ON_CURRENT_PROFILE = (raw: Raw) =>
  raw.sql`(m."profileVersion" >= p."matchVersion")
    AND (m."eligibilityVersion" IS NULL OR m."eligibilityVersion" >= u."eligibilityVersion")`.returns(
    BOOL,
  );

/**
 * A published profile `p` has no row for the job `j` decided on its facts `f` and its
 * current extraction (whose `needsReview` the decision reads) by this matcher, on the
 * profile and eligibility as they are now.
 */
const STALE_ROW = (raw: Raw) =>
  raw.sql`NOT EXISTS (
    SELECT 1 FROM job_matches m JOIN users u ON u.id = m."userId"
    WHERE m."profileId" = p.id AND m."jobId" = j.id
      AND m."factsHash" = f."factsHash" AND m."extractionId" = j."currentExtractionId"
      AND m."matcherVersion" >= ${MATCHER_VERSION}::int
      AND ${ON_CURRENT_PROFILE(raw)})`.returns(BOOL);

@Injectable()
export class PrismaMatcherRepository extends MatcherRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly rates: RatesRepository,
  ) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async loadCandidate(jobId: string): Promise<MatchCandidate | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT e.id AS "extractionId", e."needsReview"
        FROM normalized_jobs j JOIN job_extractions e ON e.id = j."currentExtractionId"
        WHERE j.id = ${jobId}::uuid AND ${matchable(raw)}`
        .returnsRow({ extractionId: UUID, needsReview: BOOL })
        .build(),
    );
    return row
      ? {
          extractionId: row.extractionId as string,
          needsReview: row.needsReview as boolean,
        }
      : null;
  }

  async listPublishedProfiles(
    opts: { onlyStaleFor?: StaleFor } = {},
  ): Promise<MatchProfile[]> {
    const { raw, orm } = this.db;
    const stale = opts.onlyStaleFor;
    const staleIds = stale
      ? new Set(
          (
            await this.db.query(
              raw.sql`SELECT p.id FROM profiles p
                WHERE p.state = 'published' AND NOT EXISTS (
                  SELECT 1 FROM job_matches m JOIN users u ON u.id = m."userId"
                  WHERE m."profileId" = p.id AND m."jobId" = ${stale.jobId}::uuid
                    AND m."factsHash" = ${stale.factsHash}::text
                    AND m."extractionId" = ${stale.extractionId}::uuid
                    AND m."matcherVersion" >= ${MATCHER_VERSION}::int
                    AND ${ON_CURRENT_PROFILE(raw)})`
                .returnsRow({ id: UUID })
                .build(),
            )
          ).map((r) => r.id as string),
        )
      : null;
    const profiles = (
      await orm.public.Profile.where({ state: 'published' }).all()
    ).filter((p) => !staleIds || staleIds.has(p.id));
    if (profiles.length === 0) return [];
    const ids = new Set(profiles.map((p) => p.id));
    const skills = new Map<string, MatchProfile['skills']>();
    for (const s of await orm.public.ProfileSkill.where((row) =>
      row.profileId.in([...ids]),
    ).all()) {
      const list = skills.get(s.profileId) ?? [];
      list.push({
        technology: s.technology,
        mastery: s.mastery,
        importance: s.importance,
      });
      skills.set(s.profileId, list);
    }
    const eligibility = await this.loadEligibility(
      new Set(profiles.map((p) => p.userId)),
    );
    return profiles.map((p) => ({
      id: p.id,
      matchVersion: p.matchVersion,
      userId: p.userId,
      position: p.position,
      seniorities: [...p.seniorities],
      yearsOfExperience: p.yearsOfExperience,
      timezoneMin: p.timezoneMin,
      timezoneMax: p.timezoneMax,
      locations: p.locations as unknown as PlacesByArrangement,
      skills: skills.get(p.id) ?? [],
      salaryMin: p.salaryMin,
      salaryCurrency: p.salaryCurrency,
      salaryPeriod: p.salaryPeriod as MatchProfile['salaryPeriod'],
      acceptsAnyCurrency: p.acceptsAnyCurrency,
      acceptedCurrencies: [...p.acceptedCurrencies],
      contractTypes: [...p.contractTypes],
      // The database checks the shape (assert_languages); keep only what the rule reads.
      languages: (p.languages as unknown as MatchProfile['languages']).map(
        ({ lang, level }) => ({ lang, level }),
      ),
      eligibility: eligibility.get(p.userId)?.eligibility ?? {
        authorizations: [],
        residenceCountry: null,
        acceptsSponsorship: null,
      },
      eligibilityVersion: eligibility.get(p.userId)?.version ?? 0,
      // Task 4 loads the real values.
      blockedAuthors: [],
      postSearch: false,
    }));
  }

  /**
   * Each user's eligibility and its version, read once for every profile of the batch. The
   * version is read before the authorizations: a change in between leaves the row stale.
   */
  private async loadEligibility(
    userIds: Set<string>,
  ): Promise<Map<string, { eligibility: MatchEligibility; version: number }>> {
    const { orm } = this.db;
    const ids = [...userIds];
    const out = new Map<
      string,
      { eligibility: MatchEligibility; version: number }
    >();
    for (const u of await orm.public.User.where((row) => row.id.in(ids)).all())
      out.set(u.id, {
        eligibility: {
          authorizations: [],
          residenceCountry: u.residenceCountry,
          acceptsSponsorship: u.acceptsSponsorship,
        },
        version: u.eligibilityVersion,
      });
    for (const a of await orm.public.WorkAuthorization.where((row) =>
      row.userId.in(ids),
    ).all())
      out
        .get(a.userId)
        ?.eligibility.authorizations.push({ kind: a.kind, place: a.place });
    return out;
  }

  async loadContext(): Promise<MatchContext> {
    const { raw } = this.db;
    const regions = await this.db.query(
      raw.sql`SELECT "regionCode", "countryCode" FROM region_countries`
        .returnsRow({ regionCode: TEXT, countryCode: TEXT })
        .build(),
    );
    const cities = await this.db.query(
      raw.sql`SELECT id, "countryCode", name FROM cities`
        .returnsRow({ id: UUID, countryCode: TEXT, name: TEXT })
        .build(),
    );
    const countries = await this.db.query(
      raw.sql`SELECT code FROM countries WHERE status = 'approved'`
        .returnsRow({ code: TEXT })
        .build(),
    );
    const tags = await this.db.query(
      raw.sql`SELECT code, to_jsonb(implies) AS implies FROM tech_tags WHERE status = 'approved'`
        .returnsRow({ code: TEXT, implies: JSONB })
        .build(),
    );
    const countriesOfRegion = new Map<string, Set<string>>();
    for (const r of regions) {
      const set = countriesOfRegion.get(r.regionCode as string) ?? new Set();
      set.add(r.countryCode as string);
      countriesOfRegion.set(r.regionCode as string, set);
    }
    return {
      rates: await this.rates.all(),
      places: {
        countriesOfRegion,
        countryOfCity: new Map(
          cities.map((c) => [c.id as string, c.countryCode as string]),
        ),
        countries: new Set(countries.map((c) => c.code as string)),
        nameOfCity: new Map(
          cities.map((c) => [c.id as string, c.name as string]),
        ),
      },
      implies: new Map(
        tags.map((t) => [
          t.code as string,
          (t.implies as unknown as string[]) ?? [],
        ]),
      ),
    };
  }

  /** `decidedAt` moves only when the outcome changes. */
  async upsertMatches(rows: StoredMatch[]): Promise<{ deliveryIds: string[] }> {
    const deliveryIds: string[] = [];
    if (rows.length === 0) return { deliveryIds };
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        const [stored] = await tx.query(
          tx.raw.sql`INSERT INTO job_matches
              (id, "userId", "profileId", "jobId", "extractionId", "factsHash", "matcherVersion",
               "profileVersion", "eligibilityVersion",
               outcome, unverified, "reviewRule", "reviewField", "stackScore", checks, "decidedAt")
            VALUES (${randomUUID()}::uuid, ${r.userId}::uuid, ${r.profileId}::uuid, ${r.jobId}::uuid,
              ${r.extractionId}::uuid, ${r.factsHash}::text, ${MATCHER_VERSION}::int,
              NULLIF(${r.profileVersion === null ? '' : String(r.profileVersion)}::text, '')::int,
              NULLIF(${r.eligibilityVersion === null ? '' : String(r.eligibilityVersion)}::text, '')::int,
              ${r.outcome}::text,
              ${r.unverified}::boolean,
              NULLIF(${r.review?.rule ?? ''}::text, ''), NULLIF(${r.review?.field ?? ''}::text, ''),
              NULLIF(${r.stackScore === null ? '' : String(r.stackScore)}::text, '')::numeric,
              ${JSON.stringify(r.checks)}::jsonb, now())
            ON CONFLICT ("profileId", "jobId") DO UPDATE SET
              "extractionId" = EXCLUDED."extractionId", "factsHash" = EXCLUDED."factsHash",
              "matcherVersion" = EXCLUDED."matcherVersion",
              "profileVersion" = EXCLUDED."profileVersion",
              "eligibilityVersion" = EXCLUDED."eligibilityVersion",
              outcome = EXCLUDED.outcome, unverified = EXCLUDED.unverified,
              "reviewRule" = EXCLUDED."reviewRule", "reviewField" = EXCLUDED."reviewField",
              "stackScore" = EXCLUDED."stackScore", checks = EXCLUDED.checks, "updatedAt" = now(),
              "decidedAt" = CASE WHEN job_matches.outcome = EXCLUDED.outcome
                                 THEN job_matches."decidedAt" ELSE now() END
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
        if (r.outcome !== 'qualified' || !stored) continue;
        const [delivery] = await tx.query(
          tx.raw
            .sql`SELECT webhook_enqueue_match(${stored.id as string}::uuid, 'decision') AS id`
            .returnsRow({ id: UUID })
            .build(),
        );
        if (delivery?.id) deliveryIds.push(delivery.id as string);
      }
    });
    return { deliveryIds };
  }

  async listStaleJobs(limit: number): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT j.id FROM normalized_jobs j
        JOIN job_extractions e ON e.id = j."currentExtractionId"
        LEFT JOIN job_facts f ON f."jobId" = j.id
        WHERE ${matchable(raw)}
          AND (${STALE_FACTS(raw)}
            -- A closed job is not decided again; its rows stay as they are.
            OR (NOT f.closed AND EXISTS (
              SELECT 1 FROM profiles p WHERE p.state = 'published' AND ${STALE_ROW(raw)})))
        ORDER BY j."lastSeenAt" DESC, j.id ASC
        LIMIT ${limit}::int`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((r) => r.id as string);
  }

  async listMatchableJobs(): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT j.id FROM normalized_jobs j
        JOIN job_extractions e ON e.id = j."currentExtractionId"
        WHERE ${matchable(raw)}
        ORDER BY j.id ASC`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((r) => r.id as string);
  }

  async deleteInactive(): Promise<number> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`DELETE FROM job_matches m USING normalized_jobs j
        WHERE j.id = m."jobId" AND j.status <> 'active'
        RETURNING m.id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length;
  }

  async matchesForJob(jobId: string): Promise<StoredMatch[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT "profileId", "userId", "jobId", "extractionId", "factsHash",
          "profileVersion", "eligibilityVersion", outcome,
          unverified, "reviewRule", "reviewField", "stackScore", checks
        FROM job_matches WHERE "jobId" = ${jobId}::uuid
        ORDER BY "profileId" ASC`
        .returnsRow({
          profileId: UUID,
          userId: UUID,
          jobId: UUID,
          extractionId: UUID,
          factsHash: TEXT,
          profileVersion: 'pg/int4@1',
          eligibilityVersion: 'pg/int4@1',
          outcome: TEXT,
          unverified: BOOL,
          reviewRule: TEXT,
          reviewField: TEXT,
          stackScore: 'pg/numeric@1',
          checks: JSONB,
        })
        .build(),
    );
    return rows.map((r) => ({
      profileId: r.profileId as string,
      userId: r.userId as string,
      jobId: r.jobId as string,
      extractionId: r.extractionId as string,
      factsHash: (r.factsHash as string | null) ?? '',
      profileVersion: (r.profileVersion as number | null) ?? null,
      eligibilityVersion: (r.eligibilityVersion as number | null) ?? null,
      outcome: r.outcome as Decision['outcome'],
      unverified: r.unverified as boolean,
      review:
        r.reviewRule === null
          ? null
          : {
              rule: r.reviewRule as RuleName,
              field: r.reviewField as string,
            },
      stackScore: r.stackScore === null ? null : Number(r.stackScore),
      checks: r.checks as unknown as Check[],
    }));
  }
}
