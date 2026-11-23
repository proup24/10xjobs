#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4ac2bcc5b523844f1f915c4e73dc8fb05fa6c33a5c253c8ec71f6c33ddf8677b/contract';
import startContract from '../../snapshots/4ac2bcc5b523844f1f915c4e73dc8fb05fa6c33a5c253c8ec71f6c33ddf8677b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract';
import endContract from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// Paused searches. users.searchesResumedAt is the last Resume (the engine writes it), and a published
// profile's matcher-read edit counts as one: bump_profile_match_version writes it wherever it bumps
// matchVersion of a published profile. Draft edits and resume-only saves don't bump, so they don't write it.
// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and the two below (profile-match-version-resumes, searches-resumed-backfill).

const bumpProfileMatchVersion = `CREATE OR REPLACE FUNCTION public.bump_profile_match_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    -- BEFORE UPDATE. Every column bumps unless listed here, so a new column bumps by default.
    IF (to_jsonb(NEW) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','createdAt','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','createdAt','updatedAt']) THEN
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

const backfill = `UPDATE public.users u SET "searchesResumedAt" = now()
  WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p."userId" = u.id AND p.state = 'published');`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('pausedAt', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('searchesResumedAt', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_decisions',
        index: 'job_decisions_userId_decidedAt_idx_39d93175',
        columns: ['userId', 'decidedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_user_delivered_6332df6c',
        columns: ['userId', 'deliveredAt'],
        extras: { where: sql`status = 'delivered'` },
      }),
      rawSql({
        id: 'functions.bump_profile_match_version_resumes',
        invariantId: 'profile-match-version-resumes',
        label:
          'bump_profile_match_version: a published profile edit sets users.searchesResumedAt',
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
      rawSql({
        id: 'data.searches_resumed_backfill',
        invariantId: 'searches-resumed-backfill',
        label: 'Set searchesResumedAt now for users with a published profile',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description: 'backfill users.searchesResumedAt',
            sql: backfill,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
