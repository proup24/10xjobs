#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a582d0832b036c7567fb59a6d6e00992e81a0d9cac9686812856b35084f4175d/contract';
import endContract from '../../snapshots/a582d0832b036c7567fb59a6d6e00992e81a0d9cac9686812856b35084f4175d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract';
import startContract from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Existing users ids are not auth user ids, so the rows go before users.id
      // becomes a foreign key to auth.users. Query links, hits, contacts,
      // profiles and skills cascade; raw jobs stay. It also leaves profile_skills
      // empty for its new required userId.
      rawSql({
        id: 'data.reset_users_for_auth',
        label: 'Delete users and shared query search builders',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description: 'delete every query search builder and user',
            sql: 'DELETE FROM public.query_search_builder; DELETE FROM public.users;',
          },
        ],
        postcheck: [],
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'profile_skills',
        constraint: 'profile_skills_profileId_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_profileId_idx_d9cdfcaf',
      }),
      this.dropColumn({ schema: 'public', table: 'users', column: 'email' }),
      this.dropNotNull({ schema: 'public', table: 'users', column: 'name' }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'profile_skills',
        column: 'userId',
        type: 'uuid',
      }),
      this.addUnique({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_id_userId_key',
        columns: ['id', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_profileId_userId_idx_2d3ae1fb',
        columns: ['profileId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_skills',
        foreignKey: {
          name: 'profile_skills_profileId_userId_fkey',
          columns: ['profileId', 'userId'],
          references: {
            schema: 'public',
            table: 'profiles',
            columns: ['id', 'userId'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_skills',
        foreignKey: {
          name: 'profile_skills_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_id_fkey',
          columns: ['id'],
          references: { schema: 'auth', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      // Every new auth user (signed up, created or invited) gets its users row
      // in the same transaction; EXECUTE is revoked so it only runs as the trigger.
      rawSql({
        id: 'trigger.on_auth_user_created',
        label: 'Create a users row for every new auth user',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create handle_new_auth_user() and the on_auth_user_created trigger',
            sql: `CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users (id) VALUES (NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
