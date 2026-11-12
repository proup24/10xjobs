/**
 * Lists the LinkedIn places that fell back to a country or to nothing, so
 * missing cities and aliases can be added to the vocabulary:
 *
 *   pnpm --filter @xjobs/xjobs db:places -- --days 7
 *
 * Reads LinkedIn job board jobs seen in the last N days (default 7) that carry
 * harvest location fields, and prints `count<TAB>result<TAB>text`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, DatabaseService } from 'src/database';
import {
  unmappedPlaces,
  type PlaceRow,
} from 'src/modules/facts/places/recheck';
import { PrismaPlaceVocabularyRepository } from 'src/modules/facts/places/place-vocabulary.repository';
import { linkedInJobIds } from 'src/modules/processor/repositories/processor.repository';

function parseDays(args: string[]): number {
  const i = args.indexOf('--days');
  if (i === -1) return 7;
  const days = Number(args[i + 1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days needs a positive whole number');
  }
  return days;
}

async function main(): Promise<void> {
  const logger = new Logger('Places');
  const days = parseDays(process.argv.slice(2));
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { raw } = db;
    const text = 'pg/text@1';
    const rows = (await db.query(
      raw.sql`SELECT j.location, j."countryCode", j."regionCode", j.city, j."geoId"
        FROM normalized_jobs j
        WHERE j."lastSeenAt" >= now() - make_interval(days => ${days}::int)
          AND (j."countryCode" IS NOT NULL OR j."regionCode" IS NOT NULL OR j."geoId" IS NOT NULL)
          AND j.id IN (${linkedInJobIds(raw)})`
        .returnsRow({
          location: text,
          countryCode: text,
          regionCode: text,
          city: text,
          geoId: text,
        })
        .build(),
    )) as PlaceRow[];
    const vocab = await new PrismaPlaceVocabularyRepository({
      db,
    } as DatabaseService).load();
    console.log('count\tresult\ttext');
    for (const g of unmappedPlaces(rows, vocab)) {
      console.log(`${g.count}\t${g.result}\t${g.text}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Places',
  );
  process.exit(1);
});
