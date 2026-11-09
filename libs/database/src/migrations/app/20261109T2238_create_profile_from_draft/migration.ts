#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract';
import endContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
import startContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `create-profile-from-draft` invariant in ../refs/db.json decides whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// It adds create_profile_from_draft next to create_profile_from_setup (unchanged), with the
// same SECURITY INVOKER, empty search_path and grants.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.create_profile_from_draft',
        invariantId: 'create-profile-from-draft',
        label:
          'create_profile_from_draft: create an additional profile from a new-profile (version 2) draft',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create create_profile_from_draft(p_profile_id, p_profile, p_skills)',
            sql: `CREATE OR REPLACE FUNCTION public.create_profile_from_draft(p_profile_id uuid, p_profile jsonb, p_skills jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  draft_id uuid;
  draft_answers jsonb;
  p public.profiles;
BEGIN
  -- The lock makes a second call (double submit, another tab) wait here, then find the
  -- draft gone and the profile there.
  SELECT d.id, d.answers INTO draft_id, draft_answers
    FROM public.profile_setup_drafts d
   WHERE d."userId" = auth.uid()
     FOR UPDATE;

  -- Already created (a repeated or concurrent call): return the same id. Only the caller's
  -- own profile counts, so another user's id is never returned. A draft for this same
  -- profile (saved again after creation) is ended; any other draft is left alone.
  PERFORM 1
     FROM public.profiles pr
    WHERE pr.id = p_profile_id
      AND pr."userId" = auth.uid();
  IF FOUND THEN
    IF draft_id IS NOT NULL AND draft_answers->>'newProfileId' = p_profile_id::text THEN
      DELETE FROM public.profile_setup_drafts d WHERE d.id = draft_id;
    END IF;
    RETURN p_profile_id;
  END IF;

  -- The draft must be a new-profile draft for exactly this id; the client can't forge either.
  IF draft_id IS NULL
     OR draft_answers->'version' IS DISTINCT FROM '2'::jsonb
     OR draft_answers->>'newProfileId' IS DISTINCT FROM p_profile_id::text THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no new-profile draft to create a profile from';
  END IF;

  -- Checked under the draft lock, so two flows of the same user can't both pass it.
  IF (SELECT count(*) FROM public.profiles pr WHERE pr."userId" = auth.uid()) >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'You can have at most 5 profiles';
  END IF;

  p := jsonb_populate_record(null::public.profiles, p_profile);
  -- Only the columns authenticated may insert; state, publishedAt and timestamps take their defaults.
  INSERT INTO public.profiles (
    "id", "userId", "position", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax",
    "engagements", "seniorities", "noticePeriodDays", "contractTypes", "locations", "languages",
    "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies"
  ) VALUES (
    p_profile_id, auth.uid(), p."position", p."yearsOfExperience", p."timezoneCurrent", p."timezoneMin", p."timezoneMax",
    p."engagements", p."seniorities", p."noticePeriodDays", p."contractTypes", p."locations", p."languages",
    p."salaryMin", p."salaryCurrency", p."salaryPeriod",
    -- An omitted key keeps the column default (true, '{}') instead of becoming null.
    COALESCE(p."acceptsAnyCurrency", true), COALESCE(p."acceptedCurrencies", '{}'::text[])
  );

  INSERT INTO public.profile_skills ("id", "userId", "profileId", "technology", "domain", "mastery", "importance")
  SELECT gen_random_uuid(), auth.uid(), p_profile_id, s.technology, s.domain, s.mastery, s.importance
    FROM jsonb_to_recordset(p_skills) AS s(technology text, domain text, mastery integer, importance integer);

  DELETE FROM public.profile_setup_drafts d WHERE d.id = draft_id;
  RETURN p_profile_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_profile_from_draft(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_profile_from_draft(uuid, jsonb, jsonb) TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
