#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract';
import endContract from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract';
import startContract from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and profile-switches-no-bump.
// A switch (postSearch, indeedSearch) is an engine write, not a preference: it never bumps matchVersion.

const bumpProfileMatchVersion = `CREATE OR REPLACE FUNCTION public.bump_profile_match_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    -- BEFORE UPDATE. Every column bumps unless listed here, so a new column bumps by default.
    IF (to_jsonb(NEW) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','indeedSearch','createdAt','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','indeedSearch','createdAt','updatedAt']) THEN
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
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('indeedSearch', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      rawSql({
        id: 'functions.bump_profile_match_version_switches',
        invariantId: 'profile-switches-no-bump',
        label: 'bump_profile_match_version: indeedSearch never bumps',
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
