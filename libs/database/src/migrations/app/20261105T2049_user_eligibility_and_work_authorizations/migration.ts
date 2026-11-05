#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/d98f2850be8e35f00800f50fbfc7a8296a77a8de3e92bee38c209fdeb472e2ef/contract';
import startContract from '../../snapshots/d98f2850be8e35f00800f50fbfc7a8296a77a8de3e92bee38c209fdeb472e2ef/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e9fcc42378de0b782a733a81a74ade71b11183f32391d3e9cbec5fb36ef2c85c/contract';
import endContract from '../../snapshots/e9fcc42378de0b782a733a81a74ade71b11183f32391d3e9cbec5fb36ef2c85c/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'work_authorizations',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('kind', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('place', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('userId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'work_authorizations_kind_f83cbcae',
            sql`kind IN ('work-permit','citizenship','residency','clearance')`,
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('acceptsSponsorship', 'bool', {
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('residenceCountry', 'text', {
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'work_authorizations',
        constraint: 'work_authorizations_userId_kind_place_key',
        columns: ['userId', 'kind', 'place'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'work_authorizations',
        index: 'work_authorizations_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'work_authorizations',
        foreignKey: {
          name: 'work_authorizations_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'work_authorizations',
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'work_authorizations',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'work_authorizations_owner',
            hash: '6ea08fe5',
          },
          tableName: 'work_authorizations',
          namespaceId: 'public',
          operation: 'all',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      // Codes are checked by BEFORE triggers (see 20261105T2017), not foreign keys, so
      // only approved codes count. Bad codes raise check_violation (23514).
      rawSql({
        id: 'trigger.users_check_codes',
        label: 'Check the residence country against the countries list',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create users_check_codes() and its BEFORE INSERT OR UPDATE trigger',
            sql: `CREATE FUNCTION public.users_check_codes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- The sign-up trigger inserts empty rows, so null passes. On update, only a changed value is checked.
  IF NEW."residenceCountry" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."residenceCountry" IS DISTINCT FROM OLD."residenceCountry") THEN
    PERFORM public.assert_codes('users.residenceCountry', 'countries', ARRAY[NEW."residenceCountry"]);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.users_check_codes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER users_check_codes BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_check_codes();`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'trigger.work_authorizations_check_codes',
        label:
          'Check work authorization places against the countries and regions lists',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'work_authorizations',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'create work_authorizations_check_codes() and its BEFORE INSERT OR UPDATE trigger',
            sql: `CREATE FUNCTION public.work_authorizations_check_codes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.place IS DISTINCT FROM OLD.place THEN
    -- GLOBAL is an approved region for jobs, but a place of authorization is a real country or region.
    IF NEW.place = 'GLOBAL' THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('work_authorizations.place: %L is not an approved regions code', NEW.place);
    END IF;
    IF EXISTS (SELECT 1 FROM public.countries c WHERE c.code = NEW.place AND c.status = 'approved') THEN
      RETURN NEW;
    END IF;
    PERFORM public.assert_codes('work_authorizations.place', 'regions', ARRAY[NEW.place]);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_authorizations_check_codes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_authorizations_check_codes BEFORE INSERT OR UPDATE ON public.work_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.work_authorizations_check_codes();`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
