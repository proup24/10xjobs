import { Arrangement, Channel } from 'src/common/enums';
import {
  QUERY_SEARCH_RECIPE_VERSION,
  recipeHash,
  roleWords,
  searchSpellings,
} from '../builders';
import { linkedinKeyword } from '../channels/linkedin_keyword';
import { packLinkedinTechnologies, topSkills } from '../sets/technology';
import type {
  LocationArrangement,
  QuerySearchProfileInput,
  QuerySearchRecipe,
} from '../types';

/** One Indeed search: a country site and a location text (empty: the whole site). */
export type IndeedPlace = {
  site: string;
  location: string;
  type: Arrangement;
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where the profile searches Indeed. Remote searches every main market. Each
 * named country with a market row gets one whole-site search whatever its
 * arrangements (valig has no arrangement filter, so the matcher decides); a
 * country named only for remote that is a main market adds nothing; a city
 * searches its own text unless its country has a whole-site search. Regions
 * have no country and add nothing. Deduped, sorted by site then location.
 */
export function indeedPlaces(input: QuerySearchProfileInput): IndeedPlace[] {
  const markets = input.indeedMarkets ?? [];
  if (markets.length === 0) return [];
  const bySite = new Map(markets.map((market) => [market.countryCode, market]));
  const places: IndeedPlace[] = [];

  if (input.locations.remote.length > 0)
    for (const market of markets)
      if (market.mainRemote)
        places.push({
          site: market.site,
          location: market.remoteLocation,
          type: Arrangement.remote,
        });

  const wholeSites = new Set<string>();
  const cities: { site: string; city: string }[] = [];
  const arrangements: LocationArrangement[] = [
    Arrangement.remote,
    Arrangement.hybrid,
    Arrangement.onsite,
  ];
  for (const arrangement of arrangements) {
    for (const place of input.placeCountries?.[arrangement] ?? []) {
      const market = bySite.get(place.countryCode);
      if (!market) continue;
      if (arrangement === Arrangement.remote && market.mainRemote) continue;
      if (place.city === null || arrangement === Arrangement.remote)
        wholeSites.add(market.site);
      else cities.push({ site: market.site, city: place.city });
    }
  }
  for (const site of wholeSites)
    places.push({ site, location: '', type: Arrangement.unstated });
  for (const { site, city } of cities)
    if (!wholeSites.has(site))
      places.push({ site, location: city, type: Arrangement.unstated });

  const seen = new Set<string>();
  return places
    .filter((place) => {
      const key = `${place.site}\0${place.location}\0${place.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compare(a.site, b.site) || compare(a.location, b.location));
}

/**
 * The profile's Indeed searches: one recipe per place and technology set. The
 * keyword is the LinkedIn one (role words AND spellings); there is no
 * seniority filter or word, so the matcher judges levels.
 */
export function indeedRecipes(
  input: QuerySearchProfileInput,
): QuerySearchRecipe[] {
  const places = indeedPlaces(input);
  const ranked = topSkills(input.skills);
  if (places.length === 0 || ranked.length === 0) return [];
  const roles = roleWords(input.position, input.languages);
  if (roles.length === 0) return [];
  const sets = packLinkedinTechnologies(ranked, roles);

  const recipes: QuerySearchRecipe[] = [];
  for (const place of places) {
    for (const set of sets) {
      const spellings = [
        ...new Set(set.technologies.flatMap(searchSpellings)),
      ].sort();
      const recipe = {
        channel: Channel.INDEED,
        position: input.position,
        location: `${place.site}:${place.location || '*'}`.toLowerCase(),
        experience: 'unstated',
        type: place.type,
        technologies: set.technologies,
        domain: set.domain,
        languages: input.languages,
        version: QUERY_SEARCH_RECIPE_VERSION,
        keyword: linkedinKeyword(roles, spellings),
        params: {
          site: place.site,
          location: place.location,
          roleWords: roles,
          spellings,
        },
      };
      recipes.push({ ...recipe, hash: recipeHash(recipe) });
    }
  }
  return recipes;
}
