import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { JobFactsDocument } from '../schema/facts';
import type { FactConflict } from '../rules/combine';
import type { ListingRow } from '../rules/listing';

export interface FactsInputs {
  extractionId: string;
  /** The stored `job_extractions.data`, not yet parsed. */
  extraction: unknown;
  schemaVersion: number;
  /** The job row's `updatedAt` as read: the facts are built as of it. */
  jobUpdatedAt: Date;
  listing: ListingRow;
  /** `normalized_jobs.descriptionText`: the posting's languages are detected from it. */
  descriptionText: string | null;
}

export interface SavedFacts {
  jobId: string;
  extractionId: string;
  /**
   * The job's `updatedAt` when its inputs were loaded, so an ingest change between the load
   * and the save leaves the facts stale (`j."updatedAt" > f."builtAt"`).
   */
  builtAt: Date;
  factsVersion: number;
  factsHash: string;
  facts: JobFactsDocument;
  closed: boolean;
  conflicts: FactConflict[];
}

/** Every read and write the facts build makes. */
export abstract class FactsRepository {
  /** The job's current extraction and its LinkedIn listing columns; null without a current extraction. */
  abstract loadInputs(jobId: string): Promise<FactsInputs | null>;
  /** The stored hash and version, never the build time. */
  abstract current(
    jobId: string,
  ): Promise<{ factsHash: string; factsVersion: number } | null>;
  /** Upserts the facts row (always setting `builtAt`) and replaces the job's conflicts in one transaction. */
  abstract save(row: SavedFacts): Promise<void>;
  /**
   * Marks stale (`builtAt = '-infinity'`) the facts of jobs listed in a country, or whose
   * openings name it (a country place, or a city place in it); returns how many.
   */
  abstract markStale(where: { countryCode: string }): Promise<number>;
}

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';
const INT = 'pg/int4@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

const WORKPLACE = new Set(['remote', 'hybrid', 'onsite']);

@Injectable()
export class PrismaFactsRepository extends FactsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async loadInputs(jobId: string): Promise<FactsInputs | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT e.id AS "extractionId", e."schemaVersion", e.data,
          j."workplaceType", j."countryCode", j."regionCode", j.city, j."geoId",
          j.location, j."salaryMin", j."salaryMax", j."salaryCurrency",
          j."salaryPeriod", j."salaryProvidedByEmployer", j."experienceLevel",
          j."contractType", j."expiresAt", j."updatedAt", j."descriptionText"
        FROM normalized_jobs j JOIN job_extractions e ON e.id = j."currentExtractionId"
        WHERE j.id = ${jobId}::uuid`
        .returnsRow({
          extractionId: UUID,
          schemaVersion: INT,
          data: JSONB,
          workplaceType: TEXT,
          countryCode: TEXT,
          regionCode: TEXT,
          city: TEXT,
          geoId: TEXT,
          location: TEXT,
          salaryMin: INT,
          salaryMax: INT,
          salaryCurrency: TEXT,
          salaryPeriod: TEXT,
          salaryProvidedByEmployer: BOOL,
          experienceLevel: TEXT,
          contractType: TEXT,
          expiresAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
          descriptionText: TEXT,
        })
        .build(),
    );
    if (!row) return null;
    const workplace = row.workplaceType as string | null;
    return {
      extractionId: row.extractionId as string,
      extraction: row.data,
      schemaVersion: row.schemaVersion as number,
      jobUpdatedAt: row.updatedAt as Date,
      descriptionText: row.descriptionText as string | null,
      listing: {
        workplaceType:
          workplace !== null && WORKPLACE.has(workplace)
            ? (workplace as ListingRow['workplaceType'])
            : null,
        countryCode: row.countryCode as string | null,
        regionCode: row.regionCode as string | null,
        city: row.city as string | null,
        geoId: row.geoId as string | null,
        location: row.location as string | null,
        salaryMin: row.salaryMin as number | null,
        salaryMax: row.salaryMax as number | null,
        salaryCurrency: row.salaryCurrency as string | null,
        salaryPeriod: row.salaryPeriod as string | null,
        salaryProvidedByEmployer: row.salaryProvidedByEmployer as
          | boolean
          | null,
        experienceLevel: row.experienceLevel as string | null,
        contractType: row.contractType as string | null,
        expiresAt: row.expiresAt as Date | null,
      },
    };
  }

  async current(
    jobId: string,
  ): Promise<{ factsHash: string; factsVersion: number } | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT "factsHash", "factsVersion" FROM job_facts
        WHERE "jobId" = ${jobId}::uuid`
        .returnsRow({ factsHash: TEXT, factsVersion: INT })
        .build(),
    );
    return row
      ? {
          factsHash: row.factsHash as string,
          factsVersion: row.factsVersion as number,
        }
      : null;
  }

  async save(row: SavedFacts): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        tx.raw.sql`INSERT INTO job_facts
            ("jobId", "extractionId", "factsVersion", "factsHash", facts, closed, "builtAt", "createdAt", "updatedAt")
          VALUES (${row.jobId}::uuid, ${row.extractionId}::uuid, ${row.factsVersion}::int,
            ${row.factsHash}::text, ${JSON.stringify(row.facts)}::jsonb, ${row.closed}::boolean,
            ${row.builtAt.toISOString()}::timestamptz, now(), now())
          ON CONFLICT ("jobId") DO UPDATE SET
            "extractionId" = EXCLUDED."extractionId", "factsVersion" = EXCLUDED."factsVersion",
            "factsHash" = EXCLUDED."factsHash", facts = EXCLUDED.facts, closed = EXCLUDED.closed,
            "builtAt" = EXCLUDED."builtAt", "updatedAt" = now()`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw
          .sql`DELETE FROM job_fact_conflicts WHERE "jobId" = ${row.jobId}::uuid`
          .affectedCount()
          .build(),
      );
      for (const c of row.conflicts)
        await tx.execute(
          tx.raw.sql`INSERT INTO job_fact_conflicts
              (id, "jobId", "extractionId", field, "listingValue", "descriptionValue", quote, winner)
            VALUES (${randomUUID()}::uuid, ${row.jobId}::uuid, ${row.extractionId}::uuid,
              ${c.field}::text, ${JSON.stringify(c.listingValue ?? null)}::jsonb,
              ${JSON.stringify(c.descriptionValue ?? null)}::jsonb, ${c.quote}::text, ${c.winner}::text)`
            .affectedCount()
            .build(),
        );
    });
  }

  async markStale(where: { countryCode: string }): Promise<number> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE job_facts f SET "builtAt" = '-infinity', "updatedAt" = now()
        FROM normalized_jobs j
        WHERE j.id = f."jobId"
          AND (j."countryCode" = ${where.countryCode}::text
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(f.facts->'openings') o,
                jsonb_array_elements(o->'places') pl
              WHERE CASE pl->>'kind'
                WHEN 'country' THEN pl->>'code'
                WHEN 'city' THEN pl->>'countryCode'
              END = ${where.countryCode}::text))
        RETURNING f."jobId"`
        .returnsRow({ jobId: UUID })
        .build(),
    );
    return rows.length;
  }
}
