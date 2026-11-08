#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract';
import startContract from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/888075ad022526b1838845dbd48fde015f395986010ef9199c82d6bec4a6c4db/contract';
import endContract from '../../snapshots/888075ad022526b1838845dbd48fde015f395986010ef9199c82d6bec4a6c4db/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // 1. No production data exists, and PR B already cleared dev profiles missing a
      // new field, so this is expected to delete nothing. It runs on the old names,
      // before the columns are dropped, renamed and made NOT NULL.
      rawSql({
        id: 'data.profiles_delete_without_final_fields',
        label:
          'Delete dev profiles missing places, spokenLanguages or contractTypes',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'delete profiles missing a field that becomes required',
            sql: `DELETE FROM public.profiles
WHERE places IS NULL OR "spokenLanguages" IS NULL OR "contractTypes" IS NULL;`,
          },
        ],
        postcheck: [],
      }),
      // 2. Drop the old shape and its checks. The final-name checks below reuse the
      // names profiles_languages_nonempty and profiles_locations_nonempty, so these go first.
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_contract_types_nonempty_2e2f0c84',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_languages_check_dd30c302',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_languages_elem_not_null_d4aa0a00',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_languages_nonempty_ee0e6ea8',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_shape_c8b4dcae',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_nonempty_dfbcb81c',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'country',
      }),
      this.dropColumn({ schema: 'public', table: 'profiles', column: 'city' }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'languages',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'locations',
      }),
      // 3. The final names. renameColumn checks against the start contract, which
      // still has the old locations and languages columns, so this is raw SQL.
      rawSql({
        id: 'columns.profiles_final_names',
        label:
          'Rename profiles places to locations and spokenLanguages to languages',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'rename places and spokenLanguages',
            sql: `ALTER TABLE public.profiles RENAME COLUMN places TO locations;
ALTER TABLE public.profiles RENAME COLUMN "spokenLanguages" TO languages;`,
          },
        ],
        postcheck: [],
      }),
      // 4. Required, with the final-name checks.
      this.setNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'contractTypes',
      }),
      this.setNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'locations',
      }),
      this.setNotNull({
        schema: 'public',
        table: 'profiles',
        column: 'languages',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_contract_types_nonempty_fff662eb',
        expression: sql`cardinality("contractTypes") > 0`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_nonempty_dfbcb81c',
        expression: sql`jsonb_path_exists("locations", '$.*[*]')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_languages_nonempty_ba8ae822',
        expression: sql`jsonb_typeof("languages") = 'array' AND jsonb_array_length("languages") > 0`,
      }),
      // 5. The trigger function from 20261105T2017, on the final names, with the
      // final field names in its messages. Same signature, SECURITY DEFINER and
      // empty search_path; the profiles_check_codes trigger keeps calling it.
      rawSql({
        id: 'function.profiles_check_codes_final_names',
        label: 'Check profile codes on the final column names',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'replace profiles_check_codes()',
            sql: `CREATE OR REPLACE FUNCTION public.profiles_check_codes() RETURNS trigger
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
  IF ins OR NEW.locations IS DISTINCT FROM OLD.locations THEN
    PERFORM public.assert_places('profiles.locations', NEW.locations);
  END IF;
  IF ins OR NEW.languages IS DISTINCT FROM OLD.languages THEN
    PERFORM public.assert_languages('profiles.languages', NEW.languages);
  END IF;
  IF NEW."salaryCurrency" IS NOT NULL AND (ins OR NEW."salaryCurrency" IS DISTINCT FROM OLD."salaryCurrency") THEN
    PERFORM public.assert_codes('profiles.salaryCurrency', 'iso_currencies', ARRAY[NEW."salaryCurrency"]);
  END IF;
  IF ins OR NEW."acceptedCurrencies" IS DISTINCT FROM OLD."acceptedCurrencies" THEN
    PERFORM public.assert_codes('profiles.acceptedCurrencies', 'iso_currencies', NEW."acceptedCurrencies");
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_check_codes() FROM PUBLIC, anon, authenticated;`,
          },
        ],
        postcheck: [],
      }),
      // 6. Re-issue the questionnaire grants from 20261105T2017 with the final column list.
      rawSql({
        id: 'grants.profiles_user_columns_final_names',
        label:
          'Limit authenticated writes on profiles to the questionnaire columns, final names',
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
GRANT INSERT ("id", "userId", "position", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays", "contractTypes", "locations", "languages", "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies") ON public.profiles TO authenticated;
GRANT UPDATE ("position", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays", "contractTypes", "locations", "languages", "salaryMin", "salaryCurrency", "salaryPeriod", "acceptsAnyCurrency", "acceptedCurrencies") ON public.profiles TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
