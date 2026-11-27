import type { DatabaseClient } from '@xjobs/database';
import type { PlaceIndex } from '../rules/places';

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';

/** The place index the matcher decides with: regions' countries, cities and approved countries. */
export async function loadPlaceIndex(db: DatabaseClient): Promise<PlaceIndex> {
  const { raw } = db;
  const regions = await db.query(
    raw.sql`SELECT "regionCode", "countryCode" FROM region_countries`
      .returnsRow({ regionCode: TEXT, countryCode: TEXT })
      .build(),
  );
  const cities = await db.query(
    raw.sql`SELECT id, "countryCode", name FROM cities`
      .returnsRow({ id: UUID, countryCode: TEXT, name: TEXT })
      .build(),
  );
  const countries = await db.query(
    raw.sql`SELECT code FROM countries WHERE status = 'approved'`
      .returnsRow({ code: TEXT })
      .build(),
  );
  const countriesOfRegion = new Map<string, Set<string>>();
  for (const r of regions) {
    const set = countriesOfRegion.get(r.regionCode as string) ?? new Set();
    set.add(r.countryCode as string);
    countriesOfRegion.set(r.regionCode as string, set);
  }
  return {
    countriesOfRegion,
    countryOfCity: new Map(
      cities.map((c) => [c.id as string, c.countryCode as string]),
    ),
    countries: new Set(countries.map((c) => c.code as string)),
    nameOfCity: new Map(cities.map((c) => [c.id as string, c.name as string])),
  };
}
