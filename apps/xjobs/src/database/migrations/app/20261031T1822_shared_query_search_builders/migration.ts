#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/011c27adc77250e0999b038bf6bcf28ff796c3c79c781a3e7b29e7093dda6209/contract';
import endContract from '../../snapshots/011c27adc77250e0999b038bf6bcf28ff796c3c79c781a3e7b29e7093dda6209/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bfacc3d4a0bb9a652f031e22963be006d874e300384a392fe43c4d1e0975548f/contract';
import startContract from '../../snapshots/bfacc3d4a0bb9a652f031e22963be006d874e300384a392fe43c4d1e0975548f/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_profileId_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_userId_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_profileId_hash_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_profileId_channel_idx_6dd870f6',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_profileId_idx_d9cdfcaf',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_userId_idx_a489d58a',
      }),
      this.dropColumn({ schema: 'public', table: 'query_search_builder', column: 'userId' }),
      this.dropColumn({ schema: 'public', table: 'query_search_builder', column: 'profileId' }),
      this.createTable({
        schema: 'public',
        table: 'profile_query_search_builders',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('profileId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('queryId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('associatedProfiles', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('isActive', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('isDeleted', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'profile_query_search_builders',
        constraint: 'profile_query_search_builders_profileId_queryId_key',
        columns: ['profileId', 'queryId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_associated_profiles_dccf74eb',
        expression: sql`"associatedProfiles" >= 0`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_deleted_inactive_11da4d0f',
        expression: sql`NOT ("isDeleted" AND "isActive")`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_hash_key',
        columns: ['hash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_query_search_builders',
        index: 'profile_query_search_builders_profileId_idx_d9cdfcaf',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_query_search_builders',
        index: 'profile_query_search_builders_queryId_idx_edc2d44a',
        columns: ['queryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_channel_isActive_isDeleted_idx_f3572b4f',
        columns: ['channel', 'isActive', 'isDeleted'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_query_search_builders',
        foreignKey: {
          name: 'profile_query_search_builders_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'profiles', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_query_search_builders',
        foreignKey: {
          name: 'profile_query_search_builders_queryId_fkey',
          columns: ['queryId'],
          references: { schema: 'public', table: 'query_search_builder', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
