#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract';
import endContract from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract.json' with { type: 'json' };
import startContract from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so its invariants
// (replace-profile-skills-no-key-lock, set-profile-resume-no-key-lock) in ../refs/db.json decide
// whether it runs on a fresh database. Advancing the `db` ref writes `invariants: []`; re-add
// every earlier invariant and these two.
// The engine's search swap holds FOR KEY SHARE on the profile for its whole run (~30 s on the
// hosted engine). replace_profile_skills and set_profile_resume locked the profile FOR UPDATE,
// which conflicts with KEY SHARE: under the authenticated role's 8 s statement_timeout they were
// cancelled while a swap ran. Each is replaced whole from its latest definition
// (20261121T1131_profile_edits, 20261106T2113_resume_storage) with only FOR UPDATE changed to
// FOR NO KEY UPDATE, which still makes concurrent calls of either run one after the other.

const replaceProfileSkills = `CREATE OR REPLACE FUNCTION public.replace_profile_skills(p_profile_id uuid, p_skills jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Lock the caller's draft or published profile so concurrent calls (double submit, two tabs)
  -- run one after the other: the second waits, then its delete sees the first one's rows.
  -- Not the caller's profile (missing, another user's): P0002, nothing written.
  PERFORM 1
     FROM public.profiles p
    WHERE p.id = p_profile_id AND p."userId" = (SELECT auth.uid()) AND p.state IN ('draft', 'published')
      FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no profile of yours to replace the skills of';
  END IF;

  DELETE FROM public.profile_skills ps
   WHERE ps."profileId" = p_profile_id AND ps."userId" = (SELECT auth.uid());

  INSERT INTO public.profile_skills ("id", "userId", "profileId", "technology", "domain", "mastery", "importance")
  SELECT gen_random_uuid(), (SELECT auth.uid()), p_profile_id, s.technology, s.domain, s.mastery, s.importance
    FROM jsonb_to_recordset(p_skills) AS s(technology text, domain text, mastery integer, importance integer);
END $$;
REVOKE EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) TO authenticated;`;

const setProfileResume = `CREATE OR REPLACE FUNCTION public.set_profile_resume(profile_id uuid, key text, filename text, sha256 text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid();
  previous text;
  object_size bigint;
  clean text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'set_profile_resume: not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT p."resumeKey" INTO previous
  FROM public.profiles p
  WHERE p.id = set_profile_resume.profile_id AND p."userId" = uid
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_profile_resume: profile not found' USING ERRCODE = '42501';
  END IF;

  IF key IS NULL OR NOT public.resume_key_is_own(key) THEN
    RAISE EXCEPTION 'set_profile_resume: key is not a resume key in your folder'
      USING ERRCODE = '23514';
  END IF;
  IF split_part(key, '/', 2) <> set_profile_resume.profile_id::text THEN
    RAISE EXCEPTION 'set_profile_resume: key belongs to another profile'
      USING ERRCODE = '23514';
  END IF;
  IF sha256 IS NULL OR sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'set_profile_resume: sha256 must be 64 lowercase hex characters'
      USING ERRCODE = '23514';
  END IF;

  SELECT (o.metadata->>'size')::bigint INTO object_size
  FROM storage.objects o
  WHERE o.bucket_id = 'resumes' AND o.name = key;
  IF NOT FOUND OR object_size IS NULL THEN
    RAISE EXCEPTION 'set_profile_resume: no uploaded file at key'
      USING ERRCODE = '23514';
  END IF;

  clean := regexp_replace(coalesce(filename, ''), '^.*[/\\\\]', '');
  clean := regexp_replace(clean, '[^A-Za-z0-9_. -]', '_', 'g');
  clean := btrim(left(clean, 200));
  IF clean = '' THEN
    clean := 'resume.pdf';
  END IF;

  UPDATE public.profiles p
  SET "resumeKey" = key,
      "resumeFilename" = clean,
      "resumeSizeBytes" = object_size::int,
      "resumeSha256" = sha256,
      "resumeUploadedAt" = now()
  WHERE p.id = set_profile_resume.profile_id;

  RETURN previous;
END;
$$;
REVOKE ALL ON FUNCTION public.set_profile_resume(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_resume(uuid, text, text, text) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    // operationClass is 'data' because the contract does not change: the planner
    // rejects a same-hash migration with no data op.
    return [
      rawSql({
        id: 'functions.replace_profile_skills_no_key_lock',
        invariantId: 'replace-profile-skills-no-key-lock',
        label:
          'replace_profile_skills: lock the profile FOR NO KEY UPDATE, so a search swap does not block it',
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
              'replace_profile_skills(): same body, FOR NO KEY UPDATE on the profile',
            sql: replaceProfileSkills,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.set_profile_resume_no_key_lock',
        invariantId: 'set-profile-resume-no-key-lock',
        label:
          'set_profile_resume: lock the profile FOR NO KEY UPDATE, so a search swap does not block it',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'set_profile_resume(): same body, FOR NO KEY UPDATE on the profile',
            sql: setProfileResume,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
