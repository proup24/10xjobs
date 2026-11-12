import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';

const TEXT = 'pg/text@1';
const NUM = 'pg/float8@1';

/** Every read and write of the exchange rates table. */
export abstract class RatesRepository {
  /** Per-USD rates by currency code. */
  abstract all(): Promise<Map<string, number>>;
  /** Inserts or replaces the given per-USD rates and stamps them fetched now. */
  abstract upsertMany(rates: ReadonlyMap<string, number>): Promise<void>;
}

@Injectable()
export class PrismaRatesRepository extends RatesRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async all(): Promise<Map<string, number>> {
    const { raw } = this.database.db;
    const rows = await this.database.db.query(
      raw.sql`SELECT currency, "perUsd"::float8 AS "perUsd" FROM exchange_rates`
        .returnsRow({ currency: TEXT, perUsd: NUM })
        .build(),
    );
    return new Map(rows.map((r) => [r.currency as string, Number(r.perUsd)]));
  }

  async upsertMany(rates: ReadonlyMap<string, number>): Promise<void> {
    if (rates.size === 0) return;
    await this.database.db.transaction(async (tx) => {
      for (const [currency, perUsd] of rates)
        await tx.execute(
          tx.raw
            .sql`INSERT INTO exchange_rates (currency, "perUsd", "fetchedAt")
            VALUES (${currency}::text, ${String(perUsd)}::numeric, now())
            ON CONFLICT (currency) DO UPDATE SET
              "perUsd" = EXCLUDED."perUsd", "fetchedAt" = EXCLUDED."fetchedAt"`
            .affectedCount()
            .build(),
        );
    });
  }
}
