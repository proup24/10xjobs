#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract';
import endContract from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract.json' with { type: 'json' };
import startContract from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the migration changes no contract: the
      // planner rejects a same-hash migration with no data op. Sessions last 7 days from sign-in: an hourly pg_cron job deletes older
      // auth.sessions rows (refresh tokens cascade). EXECUTE is revoked so only
      // cron (running as postgres) and direct database access can call it.
      rawSql({
        id: 'function.end_expired_sessions',
        invariantId: 'end-expired-sessions',
        label: 'End sessions older than 7 days with an hourly pg_cron job',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'auth', objectType: 'table', name: 'sessions' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create end_expired_sessions() and schedule it hourly with pg_cron',
            sql: `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE FUNCTION public.end_expired_sessions() RETURNS integer
  LANGUAGE sql SET search_path = '' AS $$
  WITH ended AS (
    DELETE FROM auth.sessions WHERE created_at < now() - interval '7 days' RETURNING 1
  )
  SELECT count(*)::integer FROM ended
$$;
REVOKE EXECUTE ON FUNCTION public.end_expired_sessions() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('end-expired-sessions', '0 * * * *', 'select public.end_expired_sessions()');`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
