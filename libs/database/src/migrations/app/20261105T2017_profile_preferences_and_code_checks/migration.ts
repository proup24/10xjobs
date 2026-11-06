#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3c41b71f8adc0ec4e812059c1a4d627b2bbc7d9eb5b36c4c557ac4c8478620e3/contract';
import startContract from '../../snapshots/3c41b71f8adc0ec4e812059c1a4d627b2bbc7d9eb5b36c4c557ac4c8478620e3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d98f2850be8e35f00800f50fbfc7a8296a77a8de3e92bee38c209fdeb472e2ef/contract';
import endContract from '../../snapshots/d98f2850be8e35f00800f50fbfc7a8296a77a8de3e92bee38c209fdeb472e2ef/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('acceptedCurrencies', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('acceptsAnyCurrency', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('contractTypes', 'text[]', {
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('places', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('salaryCurrency', 'text', {
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('salaryMin', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('salaryPeriod', 'text', {
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('spokenLanguages', 'jsonb', {
          codecRef: { codecId: 'pg/jsonb@1' },
        }),
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'country',
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'languages',
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'locations',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_acceptedCurrencies_elem_not_null_12cd7376',
        expression: sql`array_position("acceptedCurrencies", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_contractTypes_elem_not_null_d79621a2',
        expression: sql`array_position("contractTypes", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_contract_types_nonempty_2e2f0c84',
        expression: sql`"contractTypes" IS NULL OR cardinality("contractTypes") > 0`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_currencies_any_xor_list_3169ca89',
        expression: sql`("acceptsAnyCurrency" AND cardinality("acceptedCurrencies") = 0) OR (NOT "acceptsAnyCurrency" AND cardinality("acceptedCurrencies") > 0)`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_salary_all_or_none_e3d82cd7',
        expression: sql`("salaryMin" IS NULL) = ("salaryCurrency" IS NULL) AND ("salaryMin" IS NULL) = ("salaryPeriod" IS NULL)`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_salary_min_positive_e1d9f874',
        expression: sql`"salaryMin" > 0`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_salary_period_fe0be813',
        expression: sql`"salaryPeriod" IN ('hour','day','month','year')`,
      }),
      // Value-list codes are checked by BEFORE triggers rather than foreign keys:
      // arrays and jsonb can't carry one, and only approved codes count. Bad codes
      // raise check_violation (23514) naming the table.column and the code.
      rawSql({
        id: 'functions.vocab_code_asserts',
        label:
          'Create assert_codes, assert_places and assert_languages for value-list codes',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'create assert_codes(field, list, codes)',
            sql: `CREATE FUNCTION public.assert_codes(field text, list text, codes text[]) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  bad text;
BEGIN
  IF codes IS NULL OR cardinality(codes) = 0 THEN
    RETURN;
  END IF;
  CASE list
    WHEN 'tech_tags' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.tech_tags t WHERE t.code = u.c AND t.status = 'approved')
        ORDER BY u.n LIMIT 1;
    WHEN 'role_kinds' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.role_kinds t WHERE t.code = u.c AND t.status = 'approved' AND t."isEngineering")
        ORDER BY u.n LIMIT 1;
    WHEN 'seniorities' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.seniorities t WHERE t.code = u.c AND t.status = 'approved' AND t.code <> 'unstated')
        ORDER BY u.n LIMIT 1;
    WHEN 'contract_types' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.contract_types t WHERE t.code = u.c AND t.status = 'approved' AND t.code <> 'unstated')
        ORDER BY u.n LIMIT 1;
    WHEN 'engagements' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.engagements t WHERE t.code = u.c AND t.status = 'approved' AND t.code <> 'unstated')
        ORDER BY u.n LIMIT 1;
    WHEN 'regions' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.regions t WHERE t.code = u.c AND t.status = 'approved')
        ORDER BY u.n LIMIT 1;
    WHEN 'countries' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.countries t WHERE t.code = u.c AND t.status = 'approved')
        ORDER BY u.n LIMIT 1;
    WHEN 'iso_languages' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.iso_languages t WHERE t.code = u.c)
        ORDER BY u.n LIMIT 1;
    WHEN 'iso_currencies' THEN
      SELECT u.c INTO bad FROM unnest(codes) WITH ORDINALITY AS u(c, n)
        WHERE NOT EXISTS (SELECT 1 FROM public.iso_currencies t WHERE t.code = u.c)
        ORDER BY u.n LIMIT 1;
    ELSE
      RAISE EXCEPTION 'assert_codes: unknown list %', list USING ERRCODE = 'invalid_parameter_value';
  END CASE;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: %L is not an approved %s code', field, bad, list);
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.assert_codes(text, text, text[]) FROM PUBLIC, anon, authenticated;`,
          },
          {
            description: 'create assert_places(field, places)',
            sql: `CREATE FUNCTION public.assert_places(field text, places jsonb) RETURNS void
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
    IF (SELECT count(DISTINCT e) <> count(*) FROM jsonb_array_elements(list) AS e) THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s lists a place more than once', field, arrangement);
    END IF;
    FOR place IN SELECT e FROM jsonb_array_elements(list) AS e LOOP
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
  END LOOP;

  -- GLOBAL is an approved region for jobs, but a profile says worldwide instead.
  IF jsonb_path_exists(places, '$.*[*] ? (@.kind == "region" && @.code == "GLOBAL")') THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: %L is not an approved regions code', field, 'GLOBAL');
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
          {
            description: 'create assert_languages(field, langs)',
            sql: `CREATE FUNCTION public.assert_languages(field text, langs jsonb) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry jsonb;
BEGIN
  IF langs IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(langs) <> 'array' OR jsonb_array_length(langs) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: must be a non-empty array of { lang, level }', field);
  END IF;
  FOR entry IN SELECT e FROM jsonb_array_elements(langs) AS e LOOP
    IF jsonb_typeof(entry) <> 'object'
       OR NOT entry ?& ARRAY['lang', 'level']
       OR (entry - ARRAY['lang', 'level']) <> '{}'::jsonb
       OR jsonb_typeof(entry -> 'lang') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s is not a { lang, level } entry', field, entry);
    END IF;
    IF jsonb_typeof(entry -> 'level') <> 'string' OR entry ->> 'level' NOT IN ('native', 'fluent', 'working') THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('%s: %s is not a language level (native, fluent, working)', field, entry -> 'level');
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT e ->> 'lang') <> count(*) FROM jsonb_array_elements(langs) AS e) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('%s: lists a language more than once', field);
  END IF;
  PERFORM public.assert_codes(field, 'iso_languages', ARRAY(
    SELECT e ->> 'lang' FROM jsonb_array_elements(langs) AS e));
END $$;
REVOKE EXECUTE ON FUNCTION public.assert_languages(text, jsonb) FROM PUBLIC, anon, authenticated;`,
          },
        ],
        postcheck: [],
      }),
      // On update only changed columns are checked, so a code that later leaves its
      // list does not block unrelated writes (the engine publishing a profile).
      rawSql({
        id: 'trigger.profiles_check_codes',
        label: 'Check profile codes against the value lists',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create profiles_check_codes() and its BEFORE INSERT OR UPDATE trigger',
            sql: `CREATE FUNCTION public.profiles_check_codes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ins boolean := TG_OP = 'INSERT';
BEGIN
  IF NEW.position IS NOT NULL AND (ins OR NEW.position IS DISTINCT FROM OLD.position) THEN
    PERFORM public.assert_codes('profiles.position', 'role_kinds', ARRAY[NEW.position::text]);
  END IF;
  IF ins OR NEW.seniorities IS DISTINCT FROM OLD.seniorities THEN
    PERFORM public.assert_codes('profiles.seniorities', 'seniorities', NEW.seniorities::text[]);
  END IF;
  IF ins OR NEW.engagements IS DISTINCT FROM OLD.engagements THEN
    PERFORM public.assert_codes('profiles.engagements', 'engagements', NEW.engagements::text[]);
  END IF;
  IF ins OR NEW."contractTypes" IS DISTINCT FROM OLD."contractTypes" THEN
    PERFORM public.assert_codes('profiles.contractTypes', 'contract_types', NEW."contractTypes");
  END IF;
  IF ins OR NEW.places IS DISTINCT FROM OLD.places THEN
    PERFORM public.assert_places('profiles.places', NEW.places);
  END IF;
  IF ins OR NEW."spokenLanguages" IS DISTINCT FROM OLD."spokenLanguages" THEN
    PERFORM public.assert_languages('profiles.spokenLanguages', NEW."spokenLanguages");
  END IF;
  IF NEW."salaryCurrency" IS NOT NULL AND (ins OR NEW."salaryCurrency" IS DISTINCT FROM OLD."salaryCurrency") THEN
    PERFORM public.assert_codes('profiles.salaryCurrency', 'iso_currencies', ARRAY[NEW."salaryCurrency"]);
  END IF;
  IF ins OR NEW."acceptedCurrencies" IS DISTINCT FROM OLD."acceptedCurrencies" THEN
    PERFORM public.assert_codes('profiles.acceptedCurrencies', 'iso_currencies', NEW."acceptedCurrencies");
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_check_codes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_check_codes BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_check_codes();`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'trigger.profile_skills_check_codes',
        label: 'Check skill technologies against tech_tags',
        operationClass: 'additive',
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
              'create profile_skills_check_codes() and its BEFORE INSERT OR UPDATE trigger',
            sql: `CREATE FUNCTION public.profile_skills_check_codes() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.technology IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.technology IS DISTINCT FROM OLD.technology) THEN
    PERFORM public.assert_codes('profile_skills.technology', 'tech_tags', ARRAY[NEW.technology::text]);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profile_skills_check_codes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profile_skills_check_codes BEFORE INSERT OR UPDATE ON public.profile_skills
  FOR EACH ROW EXECUTE FUNCTION public.profile_skills_check_codes();`,
          },
        ],
        postcheck: [],
      }),
      // Adding columns gives them no column grants. Re-issue the questionnaire grants
      // from 20261105T1246_pipeline_from_develop with the preference columns added.
      rawSql({
        id: 'grants.profiles_user_columns_preferences',
        label:
          'Limit authenticated writes on profiles to the questionnaire columns, preferences included',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke table-level writes, grant the user-editable columns',
            sql: `REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT ("id", "userId", "position", "languages", "country", "city", "locations", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays", "contractTypes", "places", "spokenLanguages", "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies") ON public.profiles TO authenticated;
GRANT UPDATE ("position", "languages", "country", "city", "locations", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays", "contractTypes", "places", "spokenLanguages", "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies") ON public.profiles TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
