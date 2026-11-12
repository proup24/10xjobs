#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1cd5de0e80eaf25816ef11aaa269f6372fda3c935e90621032e65f56392bd741/contract';
import startContract from '../../snapshots/1cd5de0e80eaf25816ef11aaa269f6372fda3c935e90621032e65f56392bd741/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract';
import endContract from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
} from '@prisma/orm-postgres/migration';

// The matcher records the users.eligibilityVersion each decision read, and re-decides a row
// whose version is older. The web app writes work_authorizations and the users columns straight
// to Supabase, and a deleted authorization leaves no trace, so triggers bump the version:
// - after each insert, update or delete of a work authorization, on its user (both users if
//   the row moved);
// - before an update of users that changes residenceCountry or acceptsSponsorship. The WHEN
//   clause skips an update that sets them to the values they already hold.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('eligibilityVersion', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('profileUpdatedAt', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('eligibilityVersion', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      rawSql({
        id: 'trigger.bump_eligibility_version',
        label:
          "Bump users.eligibilityVersion when a user's eligibility changes",
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create bump_eligibility_version() and its triggers on users and work_authorizations',
            sql: `CREATE FUNCTION public.bump_eligibility_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    -- BEFORE UPDATE, only when residenceCountry or acceptsSponsorship changed (see WHEN).
    NEW."eligibilityVersion" := OLD."eligibilityVersion" + 1;
    RETURN NEW;
  END IF;
  -- work_authorizations, AFTER each row: OLD is null on insert, NEW on delete.
  UPDATE public.users SET "eligibilityVersion" = "eligibilityVersion" + 1
    WHERE id IN (OLD."userId", NEW."userId");
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.bump_eligibility_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bump_eligibility_version BEFORE UPDATE OF "residenceCountry", "acceptsSponsorship" ON public.users
  FOR EACH ROW
  WHEN (OLD."residenceCountry" IS DISTINCT FROM NEW."residenceCountry"
        OR OLD."acceptsSponsorship" IS DISTINCT FROM NEW."acceptsSponsorship")
  EXECUTE FUNCTION public.bump_eligibility_version();
CREATE TRIGGER bump_eligibility_version AFTER INSERT OR UPDATE OR DELETE ON public.work_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.bump_eligibility_version();`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
