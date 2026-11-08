#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract';
import endContract from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/739bfe84606def2e9d718339bcc2f402d2692d2f8b0253bb6ea3a5e4c5acc9e4/contract';
import startContract from '../../snapshots/739bfe84606def2e9d718339bcc2f402d2692d2f8b0253bb6ea3a5e4c5acc9e4/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
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
        table: 'profile_setup_drafts',
        columns: [
          col('answers', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
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
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'profile_setup_drafts',
        constraint: 'profile_setup_drafts_userId_key',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_setup_drafts',
        foreignKey: {
          name: 'profile_setup_drafts_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'profile_setup_drafts',
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_setup_drafts',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_setup_drafts_owner',
            hash: '6ea08fe5',
          },
          tableName: 'profile_setup_drafts',
          namespaceId: 'public',
          operation: 'all',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      // The two functions the setup steps call through supabase-js. SECURITY INVOKER:
      // RLS, column grants and the code-check triggers apply exactly as for a direct
      // write, and their errors (field names included) reach the caller unchanged.
      // Ids come from gen_random_uuid() because the tables have no id default.
      rawSql({
        id: 'functions.create_profile_from_setup',
        invariantId: 'profile-setup-functions',
        label:
          'create_profile_from_setup: the profile, its skills and the end of the draft, in one transaction',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create create_profile_from_setup(p_profile, p_skills)',
            sql: `CREATE OR REPLACE FUNCTION public.create_profile_from_setup(p_profile jsonb, p_skills jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  draft_id uuid;
  profile_id uuid := gen_random_uuid();
  p public.profiles;
BEGIN
  -- The lock makes a second call (double submit, another tab) wait, then find no draft.
  SELECT d.id INTO draft_id
    FROM public.profile_setup_drafts d
   WHERE d."userId" = auth.uid()
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no setup draft to create a profile from';
  END IF;

  p := jsonb_populate_record(null::public.profiles, p_profile);
  -- Only the columns authenticated may insert; state, publishedAt and timestamps take their defaults.
  INSERT INTO public.profiles (
    "id", "userId", "position", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax",
    "engagements", "seniorities", "noticePeriodDays", "contractTypes", "locations", "languages",
    "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies"
  ) VALUES (
    profile_id, auth.uid(), p."position", p."yearsOfExperience", p."timezoneCurrent", p."timezoneMin", p."timezoneMax",
    p."engagements", p."seniorities", p."noticePeriodDays", p."contractTypes", p."locations", p."languages",
    p."salaryMin", p."salaryCurrency", p."salaryPeriod",
    -- An omitted key keeps the column default (true, '{}') instead of becoming null.
    COALESCE(p."acceptsAnyCurrency", true), COALESCE(p."acceptedCurrencies", '{}'::text[])
  );

  INSERT INTO public.profile_skills ("id", "userId", "profileId", "technology", "domain", "mastery", "importance")
  SELECT gen_random_uuid(), auth.uid(), profile_id, s.technology, s.domain, s.mastery, s.importance
    FROM jsonb_to_recordset(p_skills) AS s(technology text, domain text, mastery integer, importance integer);

  DELETE FROM public.profile_setup_drafts d WHERE d.id = draft_id;
  RETURN profile_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_profile_from_setup(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_profile_from_setup(jsonb, jsonb) TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        // The invariant is edge-level: the first op's invariantId routes this one too.
        id: 'functions.replace_profile_skills',
        label:
          "replace_profile_skills: swap a draft profile's whole stack in one transaction",
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'profile_skills',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'create replace_profile_skills(p_profile_id, p_skills)',
            sql: `CREATE OR REPLACE FUNCTION public.replace_profile_skills(p_profile_id uuid, p_skills jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- The draft-only skill policies refuse a published or foreign profile: the delete
  -- matches nothing and the insert raises, so the whole call rolls back.
  DELETE FROM public.profile_skills ps
   WHERE ps."profileId" = p_profile_id AND ps."userId" = auth.uid();

  INSERT INTO public.profile_skills ("id", "userId", "profileId", "technology", "domain", "mastery", "importance")
  SELECT gen_random_uuid(), auth.uid(), p_profile_id, s.technology, s.domain, s.mastery, s.importance
    FROM jsonb_to_recordset(p_skills) AS s(technology text, domain text, mastery integer, importance integer);
END $$;
REVOKE EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
