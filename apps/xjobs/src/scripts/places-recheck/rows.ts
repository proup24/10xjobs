import type { DatabaseTransaction } from '@xjobs/database';
import type { PlaceRow } from 'src/modules/facts/places/recheck';
import { linkedInJobIds } from 'src/modules/processor/repositories/processor.repository';

const TEXT = 'pg/text@1';

/**
 * LinkedIn job-board jobs seen since `since` that carry any place field: a
 * trial actor gives location text alone, so the text counts too.
 */
export async function recentPlaceRows(
  db: Pick<DatabaseTransaction, 'query' | 'raw'>,
  since: Date,
): Promise<PlaceRow[]> {
  const { raw } = db;
  return (await db.query(
    raw.sql`SELECT j.location, j."countryCode", j."regionCode", j.city, j."geoId"
      FROM normalized_jobs j
      WHERE j."lastSeenAt" >= ${since.toISOString()}::timestamptz
        AND (j."countryCode" IS NOT NULL OR j."regionCode" IS NOT NULL OR j."geoId" IS NOT NULL
          OR j.city IS NOT NULL OR j.location IS NOT NULL)
        AND j.id IN (${linkedInJobIds(raw)})`
      .returnsRow({
        location: TEXT,
        countryCode: TEXT,
        regionCode: TEXT,
        city: TEXT,
        geoId: TEXT,
      })
      .build(),
  )) as PlaceRow[];
}
