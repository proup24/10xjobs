#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract';
import endContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e9fcc42378de0b782a733a81a74ade71b11183f32391d3e9cbec5fb36ef2c85c/contract';
import startContract from '../../snapshots/e9fcc42378de0b782a733a81a74ade71b11183f32391d3e9cbec5fb36ef2c85c/contract.json' with { type: 'json' };
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
      this.createRlsPolicy({
        schema: 'public',
        table: 'cities',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'cities_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'cities',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'contract_types',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'contract_types_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'contract_types',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'countries',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'countries_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'countries',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'engagements',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'engagements_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'engagements',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'iso_currencies',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'iso_currencies_read_approved',
            hash: 'aede9d92',
          },
          tableName: 'iso_currencies',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`true`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'iso_languages',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'iso_languages_read_approved',
            hash: 'aede9d92',
          },
          tableName: 'iso_languages',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`true`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'region_countries',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'region_countries_read_approved',
            hash: 'aede9d92',
          },
          tableName: 'region_countries',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`true`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'regions',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'regions_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'regions',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'role_kinds',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'role_kinds_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'role_kinds',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'seniorities',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'seniorities_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'seniorities',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'tech_tags',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'tech_tags_read_approved',
            hash: 'd2529ebe',
          },
          tableName: 'tech_tags',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`status = 'approved'`,
          permissive: true,
        },
      }),
      // Column grants hide status, occurrences and the timestamps. service_role and
      // postgres are untouched: the engine and the processor write these tables.
      rawSql({
        id: 'grants.tech_tags_read_only',
        label: 'Limit authenticated to reading the picker columns of tech_tags',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'tech_tags' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.tech_tags FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.tech_tags TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.role_kinds_read_only',
        label:
          'Limit authenticated to reading the picker columns of role_kinds',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'role_kinds',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.role_kinds FROM anon, authenticated;
GRANT SELECT (code, label, aliases, "isEngineering") ON public.role_kinds TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.seniorities_read_only',
        label:
          'Limit authenticated to reading the picker columns of seniorities',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'seniorities',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.seniorities FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.seniorities TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.contract_types_read_only',
        label:
          'Limit authenticated to reading the picker columns of contract_types',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'contract_types',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.contract_types FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.contract_types TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.engagements_read_only',
        label:
          'Limit authenticated to reading the picker columns of engagements',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'engagements',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.engagements FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.engagements TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.regions_read_only',
        label: 'Limit authenticated to reading the picker columns of regions',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'regions' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.regions FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.regions TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.countries_read_only',
        label: 'Limit authenticated to reading the picker columns of countries',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'countries' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.countries FROM anon, authenticated;
GRANT SELECT (code, label, aliases) ON public.countries TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.cities_read_only',
        label: 'Limit authenticated to reading the picker columns of cities',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'cities' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.cities FROM anon, authenticated;
GRANT SELECT (id, name, "countryCode", aliases) ON public.cities TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.region_countries_read_only',
        label:
          'Limit authenticated to reading the picker columns of region_countries',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'region_countries',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.region_countries FROM anon, authenticated;
GRANT SELECT ("regionCode", "countryCode") ON public.region_countries TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.iso_languages_read_only',
        label:
          'Limit authenticated to reading the picker columns of iso_languages',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'iso_languages',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.iso_languages FROM anon, authenticated;
GRANT SELECT (code, label) ON public.iso_languages TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'grants.iso_currencies_read_only',
        label:
          'Limit authenticated to reading the picker columns of iso_currencies',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'iso_currencies',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT on the picker columns',
            sql: `REVOKE ALL ON public.iso_currencies FROM anon, authenticated;
GRANT SELECT (code, label) ON public.iso_currencies TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
