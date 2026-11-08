#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract';
import endContract from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract.json' with { type: 'json' };
import startContract from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `create-profile-from-setup-idempotent` invariant in ../refs/db.json decides whether it
// runs on a fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// It replaces create_profile_from_setup from 20261108T1223 in place, keeping its signature,
// SECURITY INVOKER, empty search_path and grants.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.create_profile_from_setup_idempotent',
        invariantId: 'create-profile-from-setup-idempotent',
        label:
          'create_profile_from_setup: with a profile already there, end the draft and return that profile',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'replace create_profile_from_setup(p_profile, p_skills)',
            sql: `CREATE OR REPLACE FUNCTION public.create_profile_from_setup(p_profile jsonb, p_skills jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  draft_id uuid;
  existing_id uuid;
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

  -- A profile already exists (a draft saved again after a concurrent creation, or a
  -- profile made outside setup): setup is over, so end the stray draft and return the
  -- oldest profile instead of creating a second one.
  SELECT pr.id INTO existing_id
    FROM public.profiles pr
   WHERE pr."userId" = auth.uid()
   ORDER BY pr."createdAt", pr.id
   LIMIT 1;
  IF FOUND THEN
    DELETE FROM public.profile_setup_drafts d WHERE d.id = draft_id;
    RETURN existing_id;
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
