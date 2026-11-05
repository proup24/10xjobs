import { ISO_CURRENCIES, ISO_LANGUAGES } from './iso-data';
import type { Seed } from './seed.interface';

/** The slice of an ISO table the seed uses. */
interface IsoTable {
  where(filter: { code: string }): { first(): Promise<unknown> };
  create(data: { code: string; label: string }): Promise<unknown>;
}

async function upsertAll(
  table: IsoTable,
  rows: readonly { code: string; label: string }[],
): Promise<void> {
  for (const row of rows) {
    // An existing row is left as is, like the processor lists.
    if (!(await table.where({ code: row.code }).first())) {
      await table.create({ code: row.code, label: row.label });
    }
  }
}

/** @description Seeds the ISO 639-1 language and ISO 4217 currency tables. Idempotent. */
export const isoSeed: Seed = {
  name: 'iso',
  async run(tx) {
    await upsertAll(tx.orm.public.IsoLanguage, ISO_LANGUAGES);
    await upsertAll(tx.orm.public.IsoCurrency, ISO_CURRENCIES);
  },
};
