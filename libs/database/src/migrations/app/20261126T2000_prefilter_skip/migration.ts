#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract';
import endContract from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract';
import startContract from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and profile-prefilter-no-bump.
// prefilterCheckedVersion is the engine's bookkeeping (it copies matchVersion): it never bumps
// matchVersion, or every recheck would ask for the next one.

const bumpProfileMatchVersion = `CREATE OR REPLACE FUNCTION public.bump_profile_match_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    -- BEFORE UPDATE. Every column bumps unless listed here, so a new column bumps by default.
    IF (to_jsonb(NEW) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','indeedSearch','prefilterCheckedVersion','createdAt','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','indeedSearch','prefilterCheckedVersion','createdAt','updatedAt']) THEN
      NEW."matchVersion" := OLD."matchVersion" + 1;
      IF OLD.state = 'published' AND NEW.state = 'published' THEN
        UPDATE public.users SET "searchesResumedAt" = now() WHERE id = NEW."userId";
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- profile_skills, AFTER each row: OLD is null on insert, NEW on delete.
  UPDATE public.profiles SET "matchVersion" = "matchVersion" + 1
    WHERE id IN (OLD."profileId", NEW."profileId");
  UPDATE public.users SET "searchesResumedAt" = now()
    WHERE id IN (SELECT p."userId" FROM public.profiles p
                  WHERE p.id IN (OLD."profileId", NEW."profileId") AND p.state = 'published');
  RETURN NULL;
END $$;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_status_89abdf7d',
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('processingSkip', 'jsonb', {
          codecRef: { codecId: 'pg/jsonb@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('prefilterCheckedVersion', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_status_0418256a',
        expression: sql`"processingStatus" IS NULL OR "processingStatus" IN ('pending', 'processing', 'processed', 'failed', 'archived', 'skipped')`,
      }),
      rawSql({
        id: 'functions.bump_profile_match_version_prefilter',
        invariantId: 'profile-prefilter-no-bump',
        label:
          'bump_profile_match_version: prefilterCheckedVersion never bumps',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'replace bump_profile_match_version()',
            sql: bumpProfileMatchVersion,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
