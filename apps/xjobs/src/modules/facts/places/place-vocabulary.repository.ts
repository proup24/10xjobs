import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import { cityKey, type PlaceVocabulary } from './resolver';

/** Reads the places the resolver matches against. */
export abstract class PlaceVocabularyRepository {
  /**
   * Approved regions and countries, their links, and every city (approved or
   * proposed) keyed by country and folded name or alias.
   */
  abstract load(): Promise<PlaceVocabulary>;
}

@Injectable()
export class PrismaPlaceVocabularyRepository extends PlaceVocabularyRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async load(): Promise<PlaceVocabulary> {
    const { public: tables } = this.database.db.orm;
    const regions = new Set(
      (await tables.RegionTerm.where({ status: 'approved' }).all()).map(
        (r) => r.code,
      ),
    );
    const countries = new Set(
      (await tables.Country.where({ status: 'approved' }).all()).map(
        (c) => c.code,
      ),
    );
    const regionCountries = new Map<string, Set<string>>();
    for (const link of await tables.RegionCountry.all()) {
      const set = regionCountries.get(link.regionCode) ?? new Set<string>();
      set.add(link.countryCode);
      regionCountries.set(link.regionCode, set);
    }
    const cities = new Map<string, string>();
    const cityNames = new Map<string, string>();
    // Every city is proposed or approved, so none is left out.
    const rows = await tables.City.all();
    // The canonical name wins a key over any alias, then the oldest row.
    const ordered = [...rows].sort(
      (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime(),
    );
    for (const r of ordered) cityNames.set(r.id, r.name);
    for (const r of ordered)
      if (!cities.has(cityKey(r.countryCode, r.name)))
        cities.set(cityKey(r.countryCode, r.name), r.id);
    for (const r of ordered)
      for (const alias of r.aliases) {
        const key = cityKey(r.countryCode, alias);
        if (!cities.has(key)) cities.set(key, r.id);
      }
    return { regions, countries, cities, cityNames, regionCountries };
  }
}
