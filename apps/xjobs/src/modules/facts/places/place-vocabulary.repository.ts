import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import { cityForms } from './city-forms';
import { foldPlaceName } from './fold';
import type { PlaceVocabulary } from './resolver';

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
    const countryRows = await tables.Country.where({
      status: 'approved',
    }).all();
    const countries = new Set(countryRows.map((c) => c.code));
    const countryNames = new Map<string, string>();
    for (const c of countryRows) {
      for (const n of [c.label, ...c.aliases]) {
        const key = foldPlaceName(n);
        if (key !== '' && !countryNames.has(key)) countryNames.set(key, c.code);
      }
    }
    const regionCountries = new Map<string, Set<string>>();
    for (const link of await tables.RegionCountry.all()) {
      const set = regionCountries.get(link.regionCode) ?? new Set<string>();
      set.add(link.countryCode);
      regionCountries.set(link.regionCode, set);
    }
    // Every city is proposed or approved, so none is left out.
    const rows = await tables.City.all();
    const cities = cityForms(rows);
    const cityNames = new Map(rows.map((r) => [r.id, r.name]));
    const cityCountries = new Map<string, Set<string>>();
    for (const r of rows) {
      for (const n of [r.name, ...r.aliases]) {
        const key = foldPlaceName(n);
        if (key === '') continue;
        const set = cityCountries.get(key) ?? new Set<string>();
        set.add(r.countryCode);
        cityCountries.set(key, set);
      }
    }
    return {
      regions,
      countries,
      cities,
      cityNames,
      regionCountries,
      countryNames,
      cityCountries,
    };
  }
}
