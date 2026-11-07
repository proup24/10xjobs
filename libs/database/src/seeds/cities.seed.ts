import type { Seed } from './seed.interface';
import { cityNameKey } from './vocab/city-key';
import { SEED_CITIES, type SeedCity } from './vocab/seed-cities';

/**
 * @description Builds a seed that makes every listed city `approved`. A missing
 * city is created; an existing one is promoted, and gets its approval date,
 * geonames id and missing aliases filled in. Idempotent: nothing changes, so
 * nothing is written, on a second run. Cities not in the list are untouched.
 */
export function makeCitiesSeed(cities: readonly SeedCity[]): Seed {
  return {
    name: 'cities',
    async run(tx) {
      const table = tx.orm.public.City;
      for (const city of cities) {
        const nameKey = cityNameKey(city.name);
        const { countryCode } = city;
        const existing = await table.where({ nameKey, countryCode }).first();
        const now = new Date();
        if (!existing) {
          await table.create({
            name: city.name,
            nameKey,
            countryCode,
            aliases: city.aliases,
            geonamesId: city.geonamesId,
            status: 'approved',
            occurrences: 0,
            firstSeenAt: now,
            approvedAt: now,
          });
          continue;
        }
        const changes: {
          status?: string;
          approvedAt?: Date;
          geonamesId?: number;
          aliases?: string[];
        } = {};
        if (existing.status !== 'approved') changes.status = 'approved';
        if (!existing.approvedAt) changes.approvedAt = now;
        if (existing.geonamesId == null && city.geonamesId != null) {
          changes.geonamesId = city.geonamesId;
        }
        const missing = city.aliases.filter(
          (a) => !existing.aliases.includes(a),
        );
        if (missing.length > 0) {
          changes.aliases = [...existing.aliases, ...missing];
        }
        if (Object.keys(changes).length > 0) {
          await table.where({ nameKey, countryCode }).update(changes);
        }
      }
    },
  };
}

/** The committed list of approved cities. */
export const citiesSeed: Seed = makeCitiesSeed(SEED_CITIES);
