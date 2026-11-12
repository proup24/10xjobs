import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import { FACTS_VERSION } from 'src/modules/facts/config/facts.config';
import { linkedInJobIds } from 'src/modules/processor';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import { MATCH_BACKFILL_DAYS, MATCHER_VERSION } from '../config/matcher.config';
import type { Decision, MatchContext } from '../rules/decide';
import type { Check, MatchProfile } from '../rules/types';

/** A decision as stored: one row per profile and job. */
export interface StoredMatch extends Decision {
  profileId: string;
  userId: string;
  jobId: string;
  extractionId: string;
  /** The hash of the `job_facts` the decision read; `''` on a row decided before job facts (never current). */
  factsHash: string;
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
  /** Published profiles with skills. `onlyStaleFor`: only those whose row for that job is missing, has another factsHash, or an older matcherVersion. */
  abstract listPublishedProfiles(opts?: {
    onlyStaleFor?: { jobId: string; factsHash: string };
  }): Promise<MatchProfile[]>;
  abstract loadContext(): Promise<MatchContext>;
  abstract upsertMatches(rows: StoredMatch[]): Promise<void>;
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

/** A published profile `p` has no row for the job `j` decided on its facts `f` by this matcher. */
const STALE_ROW = (raw: Raw) =>
  raw.sql`NOT EXISTS (
    SELECT 1 FROM job_matches m
    WHERE m."profileId" = p.id AND m."jobId" = j.id
      AND m."factsHash" = f."factsHash" AND m."matcherVersion" >= ${MATCHER_VERSION}::int)`.returns(
    BOOL,
  );

@Injectable()
export class PrismaMatcherRepository extends MatcherRepository {
  constructor(private readonly database: DatabaseService) {
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
    opts: { onlyStaleFor?: { jobId: string; factsHash: string } } = {},
  ): Promise<MatchProfile[]> {
    const { raw, orm } = this.db;
    const stale = opts.onlyStaleFor;
    const staleIds = stale
      ? new Set(
          (
            await this.db.query(
              raw.sql`SELECT p.id FROM profiles p
                WHERE p.state = 'published' AND NOT EXISTS (
                  SELECT 1 FROM job_matches m
                  WHERE m."profileId" = p.id AND m."jobId" = ${stale.jobId}::uuid
                    AND m."factsHash" = ${stale.factsHash}::text
                    AND m."matcherVersion" >= ${MATCHER_VERSION}::int)`
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
    return profiles.map((p) => ({
      id: p.id,
      userId: p.userId,
      position: p.position,
      seniorities: [...p.seniorities],
      yearsOfExperience: p.yearsOfExperience,
      timezoneMin: p.timezoneMin,
      timezoneMax: p.timezoneMax,
      locations: p.locations as unknown as PlacesByArrangement,
      skills: skills.get(p.id) ?? [],
    }));
  }

  async loadContext(): Promise<MatchContext> {
    const { raw } = this.db;
    const regions = await this.db.query(
      raw.sql`SELECT "regionCode", "countryCode" FROM region_countries`
        .returnsRow({ regionCode: TEXT, countryCode: TEXT })
        .build(),
    );
    const cities = await this.db.query(
      raw.sql`SELECT id, "countryCode" FROM cities`
        .returnsRow({ id: UUID, countryCode: TEXT })
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
      places: {
        countriesOfRegion,
        countryOfCity: new Map(
          cities.map((c) => [c.id as string, c.countryCode as string]),
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
  async upsertMatches(rows: StoredMatch[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const r of rows)
        await tx.execute(
          tx.raw.sql`INSERT INTO job_matches
              (id, "userId", "profileId", "jobId", "extractionId", "factsHash", "matcherVersion",
               outcome, unverified, "stackScore", checks, "decidedAt")
            VALUES (${randomUUID()}::uuid, ${r.userId}::uuid, ${r.profileId}::uuid, ${r.jobId}::uuid,
              ${r.extractionId}::uuid, ${r.factsHash}::text, ${MATCHER_VERSION}::int, ${r.outcome}::text,
              ${r.unverified}::boolean, NULLIF(${r.stackScore === null ? '' : String(r.stackScore)}::text, '')::numeric,
              ${JSON.stringify(r.checks)}::jsonb, now())
            ON CONFLICT ("profileId", "jobId") DO UPDATE SET
              "extractionId" = EXCLUDED."extractionId", "factsHash" = EXCLUDED."factsHash",
              "matcherVersion" = EXCLUDED."matcherVersion",
              outcome = EXCLUDED.outcome, unverified = EXCLUDED.unverified,
              "stackScore" = EXCLUDED."stackScore", checks = EXCLUDED.checks, "updatedAt" = now(),
              "decidedAt" = CASE WHEN job_matches.outcome = EXCLUDED.outcome
                                 THEN job_matches."decidedAt" ELSE now() END`
            .affectedCount()
            .build(),
        );
    });
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
      raw.sql`SELECT "profileId", "userId", "jobId", "extractionId", "factsHash", outcome,
          unverified, "stackScore", checks
        FROM job_matches WHERE "jobId" = ${jobId}::uuid
        ORDER BY "profileId" ASC`
        .returnsRow({
          profileId: UUID,
          userId: UUID,
          jobId: UUID,
          extractionId: UUID,
          factsHash: TEXT,
          outcome: TEXT,
          unverified: BOOL,
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
      outcome: r.outcome as Decision['outcome'],
      unverified: r.unverified as boolean,
      stackScore: r.stackScore === null ? null : Number(r.stackScore),
      checks: r.checks as unknown as Check[],
    }));
  }
}
