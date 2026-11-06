#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract';
import endContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import startContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `code-check-fixes` invariant in ../refs/db.json decides whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// It replaces functions created in 20261105T2017 and 20261105T2049 in place,
// keeping their signatures, SECURITY DEFINER and empty search_path.
export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.assert_places_fixes',
        invariantId: 'code-check-fixes',
        label:
          'assert_places: refuse scalar places, compare city ids in any case, explain GLOBAL',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
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
          MESSAGE = format('%s: %s is not a worldwide, region, country or city place', field, place);
      END IF;
      IF NOT (
        place = '{"kind": "worldwide"}'::jsonb
        OR (place ->> 'kind' IN ('region', 'country')
            AND (place - ARRAY['kind', 'code']) = '{}'::jsonb
            AND jsonb_typeof(place -> 'code') = 'string')
        OR (place ->> 'kind' = 'city'
            AND (place - ARRAY['kind', 'id']) = '{}'::jsonb
            AND jsonb_typeof(place -> 'id') = 'string')
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('%s: %s is not a worldwide, region, country or city place', field, place);
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

  -- GLOBAL is an approved region for jobs, but a profile says worldwide instead.
  IF jsonb_path_exists(places, '$.*[*] ? (@.kind == "region" && @.code == "GLOBAL")') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: %L is not allowed in a profile; use { kind: worldwide }', field, 'GLOBAL');
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
      rawSql({
        // The invariant is edge-level: the first op's invariantId routes this one too.
        id: 'trigger.work_authorizations_check_codes_message',
        label:
          'Name both lists when a work authorization place is not approved',
        operationClass: 'data',
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
            description: 'replace work_authorizations_check_codes()',
            sql: `CREATE OR REPLACE FUNCTION public.work_authorizations_check_codes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.place IS DISTINCT FROM OLD.place THEN
    -- GLOBAL is an approved region for jobs, but a place of authorization is a real country or region.
    IF NEW.place <> 'GLOBAL'
       AND (EXISTS (SELECT 1 FROM public.countries c WHERE c.code = NEW.place AND c.status = 'approved')
            OR EXISTS (SELECT 1 FROM public.regions r WHERE r.code = NEW.place AND r.status = 'approved')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('work_authorizations.place: %L is not an approved countries or regions code', NEW.place);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_authorizations_check_codes() FROM PUBLIC, anon, authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
