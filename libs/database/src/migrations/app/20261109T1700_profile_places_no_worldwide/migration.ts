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
// `profile-places-strip-worldwide` and `profile-places-no-worldwide` invariants in
// ../refs/db.json decide whether it runs on a fresh database. Advancing the `db` ref
// writes `invariants: []`; re-add both.
// A profile can no longer want Worldwide. The first op strips it from existing profiles
// (before the function changes); the second replaces assert_places from 20261105T2208
// in place, keeping its signature, SECURITY DEFINER, empty search_path and grants.

const target = {
  id: 'postgres',
  details: { schema: 'public', objectType: 'table', name: 'profiles' },
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'data.profile_places_strip_worldwide',
        invariantId: 'profile-places-strip-worldwide',
        label: 'profiles: drop worldwide from existing places',
        operationClass: 'data',
        target,
        precheck: [],
        execute: [
          {
            description: 'remove {"kind":"worldwide"} from every arrangement',
            sql: `DO $$
DECLARE
  stuck uuid[];
  lost_remote uuid[];
BEGIN
  -- Remote was only worldwide but other arrangements keep the profile valid: it is
  -- stripped below and quietly loses all remote search, so name those profiles.
  SELECT array_agg(id) INTO lost_remote
    FROM public.profiles
   WHERE jsonb_array_length(COALESCE(locations -> 'remote', '[]'::jsonb)) > 0
     AND NOT jsonb_path_exists(locations, '$.remote[*] ? (@.kind != "worldwide")')
     AND (jsonb_path_exists(locations, '$.hybrid[*] ? (@.kind != "worldwide")')
          OR jsonb_path_exists(locations, '$.onsite[*] ? (@.kind != "worldwide")'));

  UPDATE public.profiles p
     SET locations = f.filtered
    FROM (
      SELECT q.id,
             jsonb_build_object(
               'remote', (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(q.locations -> 'remote') AS e WHERE e <> '{"kind": "worldwide"}'::jsonb),
               'hybrid', (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(q.locations -> 'hybrid') AS e WHERE e <> '{"kind": "worldwide"}'::jsonb),
               'onsite', (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(q.locations -> 'onsite') AS e WHERE e <> '{"kind": "worldwide"}'::jsonb)
             ) AS filtered
        FROM public.profiles q
       WHERE jsonb_path_exists(q.locations, '$.*[*] ? (@.kind == "worldwide")')
    ) AS f
   WHERE p.id = f.id
     AND jsonb_path_exists(f.filtered, '$.*[*]');

  -- A profile whose only place is worldwide would break profiles_locations_nonempty: leave it and say so.
  SELECT array_agg(id) INTO stuck
    FROM public.profiles
   WHERE jsonb_path_exists(locations, '$.*[*] ? (@.kind == "worldwide")');
  IF stuck IS NOT NULL THEN
    RAISE NOTICE 'profiles left with a worldwide-only place, edit them by hand: %', stuck;
  END IF;
  IF lost_remote IS NOT NULL THEN
    RAISE NOTICE 'profiles whose only remote place was worldwide now have no remote places, check them: %', lost_remote;
  END IF;
END $$;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.assert_places_no_worldwide',
        invariantId: 'profile-places-no-worldwide',
        label: 'assert_places: refuse worldwide, explain it like GLOBAL',
        operationClass: 'data',
        target,
        precheck: [],
        execute: [
          {
            description: 'replace assert_places(field, places)',
            sql: `CREATE OR REPLACE FUNCTION public.assert_places(field text, places jsonb) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  arrangement text;
  list jsonb;
  place jsonb;
  city_id text;
BEGIN
  IF places IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(places) <> 'object'
     OR NOT places ?& ARRAY['remote', 'hybrid', 'onsite']
     OR (places - ARRAY['remote', 'hybrid', 'onsite']) <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: must be an object with exactly remote, hybrid and onsite', field);
  END IF;
  -- Worldwide is not a place a profile can want; checked before the shape loop so it gets its own message.
  IF jsonb_path_exists(places, '$.*[*] ? (@.kind == "worldwide")') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: worldwide is not allowed in a profile', field);
  END IF;
  FOREACH arrangement IN ARRAY ARRAY['remote', 'hybrid', 'onsite'] LOOP
    list := places -> arrangement;
    IF jsonb_typeof(list) <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s must be an array', field, arrangement);
    END IF;
    IF jsonb_array_length(list) > 20 THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s has more than 20 places', field, arrangement);
    END IF;
    FOR place IN SELECT e FROM jsonb_array_elements(list) AS e LOOP
      -- A scalar or null element is checked first: the key tests below need an object.
      IF jsonb_typeof(place) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('%s: %s is not a region, country or city place', field, place);
      END IF;
      IF NOT (
        (place ->> 'kind' IN ('region', 'country')
            AND (place - ARRAY['kind', 'code']) = '{}'::jsonb
            AND jsonb_typeof(place -> 'code') = 'string')
        OR (place ->> 'kind' = 'city'
            AND (place - ARRAY['kind', 'id']) = '{}'::jsonb
            AND jsonb_typeof(place -> 'id') = 'string')
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('%s: %s is not a region, country or city place', field, place);
      END IF;
    END LOOP;
    -- City ids are uuids, matched in any case, so compare them in lower case.
    IF (SELECT count(DISTINCT CASE WHEN e ->> 'kind' = 'city'
                              THEN jsonb_build_object('kind', 'city', 'id', lower(e ->> 'id'))
                              ELSE e END) <> count(*)
        FROM jsonb_array_elements(list) AS e) THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s lists a place more than once', field, arrangement);
    END IF;
  END LOOP;

  -- GLOBAL is an approved region for jobs, but a profile cannot want it.
  IF jsonb_path_exists(places, '$.*[*] ? (@.kind == "region" && @.code == "GLOBAL")') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: %L is not allowed in a profile', field, 'GLOBAL');
  END IF;
  PERFORM public.assert_codes(field, 'regions', ARRAY(
    SELECT p ->> 'code' FROM jsonb_path_query(places, '$.*[*] ? (@.kind == "region")') AS p));
  PERFORM public.assert_codes(field, 'countries', ARRAY(
    SELECT p ->> 'code' FROM jsonb_path_query(places, '$.*[*] ? (@.kind == "country")') AS p));

  -- Check the uuid format first so a malformed id is a check_violation, not invalid_text_representation.
  FOR city_id IN SELECT p ->> 'id' FROM jsonb_path_query(places, '$.*[*] ? (@.kind == "city")') AS p LOOP
    IF city_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.id = city_id::uuid AND c.status = 'approved') THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %L is not an approved cities code', field, city_id);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.assert_places(text, jsonb) FROM PUBLIC, anon, authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
