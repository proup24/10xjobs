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
// `replace-profile-skills-lock` invariant in ../refs/db.json decides whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// It replaces replace_profile_skills from 20261108T1223 in place, keeping its signature,
// SECURITY INVOKER, empty search_path and grants.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.replace_profile_skills_lock',
        invariantId: 'replace-profile-skills-lock',
        label:
          "replace_profile_skills: lock the draft profile first, P0002 when it is not the caller's draft",
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
              'replace replace_profile_skills(p_profile_id, p_skills)',
            sql: `CREATE OR REPLACE FUNCTION public.replace_profile_skills(p_profile_id uuid, p_skills jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Lock the caller's draft profile so concurrent calls (double submit, two tabs) run one
  -- after the other: the second waits, then its delete sees the first one's rows.
  -- Not the caller's draft (missing, published, another user's): P0002, nothing written.
  PERFORM 1
     FROM public.profiles p
    WHERE p.id = p_profile_id AND p."userId" = auth.uid() AND p.state = 'draft'
      FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no draft profile of yours to replace the skills of';
  END IF;

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
