#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/011c27adc77250e0999b038bf6bcf28ff796c3c79c781a3e7b29e7093dda6209/contract';
import startContract from '../../snapshots/011c27adc77250e0999b038bf6bcf28ff796c3c79c781a3e7b29e7093dda6209/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract';
import endContract from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropNotNull({
        schema: 'public',
        table: 'query_search_builder',
        column: 'locationRegion',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
