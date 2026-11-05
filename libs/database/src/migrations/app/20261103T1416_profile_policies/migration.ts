#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5abaecd30a151d184a01049f4add8467af6f95efad9ecbe09dcee1374256ddf9/contract';
import startContract from '../../snapshots/5abaecd30a151d184a01049f4add8467af6f95efad9ecbe09dcee1374256ddf9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b15f577ff2907eb08f954e867e5e946bab9d5c0fd59ff7ea21b798f256047089/contract';
import endContract from '../../snapshots/b15f577ff2907eb08f954e867e5e946bab9d5c0fd59ff7ea21b798f256047089/contract.json' with { type: 'json' };
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
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'profile_skills',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'profiles' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_delete',
            hash: 'e80e5c12',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid() AND p.state = 'draft')`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_insert',
            hash: '87e871a7',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid() AND p.state = 'draft')`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_update',
            hash: '7fcd0c7f',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid() AND p.state = 'draft')`,
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid() AND p.state = 'draft')`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profiles_owner_delete_draft',
            hash: '64d4802d',
          },
          tableName: 'profiles',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND state = 'draft'`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profiles_owner_insert',
            hash: 'e3abe3e0',
          },
          tableName: 'profiles',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND state = 'draft' AND "publishedAt" IS NULL`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profiles_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'profiles',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profiles_owner_update_draft',
            hash: 'b3dbbb7b',
          },
          tableName: 'profiles',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND state = 'draft'`,
          withCheck: sql`"userId" = auth.uid() AND state = 'draft' AND "publishedAt" IS NULL`,
          permissive: true,
        },
      }),
      // Users write only the profile questionnaire columns. state, publishedAt,
      // the resume* columns and the timestamps are set by the engine (service role).
      rawSql({
        id: 'grants.profiles_user_columns',
        label:
          'Limit authenticated writes on profiles to the questionnaire columns',
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
GRANT INSERT ("id", "userId", "position", "languages", "country", "city", "regions", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "arrangements", "seniority", "noticePeriodDays") ON public.profiles TO authenticated;
GRANT UPDATE ("position", "languages", "country", "city", "regions", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "arrangements", "seniority", "noticePeriodDays") ON public.profiles TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
