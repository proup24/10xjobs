/** One city the cities seed makes sure is approved. */
export interface SeedCity {
  name: string;
  countryCode: string;
  aliases: string[];
  geonamesId: number | null;
}

/**
 * Approved cities, exported from approved cities on `10xjobs-dev`; edit by
 * hand. The seed promotes and adds cities but never removes one.
 */
export const SEED_CITIES: readonly SeedCity[] = [];
