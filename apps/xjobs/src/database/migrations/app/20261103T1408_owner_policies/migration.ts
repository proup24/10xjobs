#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5abaecd30a151d184a01049f4add8467af6f95efad9ecbe09dcee1374256ddf9/contract';
import endContract from '../../snapshots/5abaecd30a151d184a01049f4add8467af6f95efad9ecbe09dcee1374256ddf9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a582d0832b036c7567fb59a6d6e00992e81a0d9cac9686812856b35084f4175d/contract';
import startContract from '../../snapshots/a582d0832b036c7567fb59a6d6e00992e81a0d9cac9686812856b35084f4175d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.enableRowLevelSecurity({ schema: 'public', table: 'contacts' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'users' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'contacts',
        policy: {
          naming: { kind: 'wire', prefix: 'contacts_owner', hash: '6ea08fe5' },
          tableName: 'contacts',
          namespaceId: 'public',
          operation: 'all',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'users',
        policy: {
          naming: { kind: 'wire', prefix: 'users_owner_read', hash: 'b499dcb9' },
          tableName: 'users',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`id = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'users',
        policy: {
          naming: { kind: 'wire', prefix: 'users_owner_update', hash: '988f7d40' },
          tableName: 'users',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`id = auth.uid()`,
          withCheck: sql`id = auth.uid()`,
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
