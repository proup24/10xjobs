import { Arrangement, type Channel, type SkillDomain } from 'src/common/enums';
import type { SwitchFlags } from '../switches';
import type { IndeedMarket } from '../indeed/markets';

/** The arrangements a profile lists locations for, in expansion order. */
export const LOCATION_ARRANGEMENTS = [
  Arrangement.remote,
  Arrangement.hybrid,
  Arrangement.onsite,
] as const;
export type LocationArrangement = (typeof LOCATION_ARRANGEMENTS)[number];

/** Per arrangement, the location texts to search in ("Europe", "Paris, France"). An empty list means that arrangement is not wanted. */
export type LocationsByArrangement = Record<LocationArrangement, string[]>;

/** Position, seniority and technology are vocabulary codes, as stored. */
export type RankedSkill = {
  technology: string;
  domain: SkillDomain;
  importance: number;
  mastery: number;
};

/** The technologies one search uses and the skill domain they came from. */
export type TechnologySet = {
  technologies: string[];
  domain: SkillDomain;
};

/** The country a place sits in; the city name when the place is a city. */
export type PlaceCountry = { countryCode: string; city: string | null };

export type QuerySearchProfileInput = {
  position: string;
  locations: LocationsByArrangement;
  seniorities: string[];
  skills: RankedSkill[];
  /** ISO codes from `profiles.languages[].lang`, lowercased and deduped. */
  languages: string[];
  /** Per arrangement, the countries its places sit in (regions and worldwide have none). Absent means none. */
  placeCountries?: Record<LocationArrangement, PlaceCountry[]>;
  /** The Indeed markets. Absent means none. */
  indeedMarkets?: readonly IndeedMarket[];
};

export type QuerySearchCombination = {
  channel: Channel;
  position: string;
  /** Canonical (lowercased) location text, whatever the arrangement. */
  location: string;
  experience: string;
  type: Arrangement;
  technologies: string[];
  /** The domain of the skill the technologies came from; part of the hash. */
  domain: SkillDomain;
  /** ISO codes of the profile's languages; they pick the role words. */
  languages: string[];
  /** One LinkedIn `f_E` code, for the LinkedIn job board only; none when the seniority is unstated. */
  experienceLevel?: string;
};

export type ChannelQuery = {
  keyword: string;
  params: Record<string, unknown>;
};

/** `position` builds the keywords and is not stored as a column. */
export type QuerySearchRecipe = QuerySearchCombination &
  ChannelQuery & { version: number; hash: string };

/** What attaching a profile to its builders did. */
export type QuerySearchAttachResult = {
  /** Shared builders created because no profile had the recipe yet. */
  created: number;
  /** Recipes that already had a shared builder (reused, not duplicated). */
  existing: number;
};

/** What swapping a profile's builders did, on top of the attach counts. */
export type QuerySearchReplaceResult = QuerySearchAttachResult & {
  /** Builders unlinked because the new recipes no longer want them. */
  released: number;
  /**
   * Why nothing changed, or null when the swap ran: the profile is no longer
   * published, or one of its search switches moved since the recipes were built.
   */
  skipped: QuerySearchReplaceSkip | null;
};

export type QuerySearchReplaceSkip = 'not_published' | 'switch_changed';

/** What the caller read on the profile when it built the recipes. */
export type QuerySearchReplaceExpected = {
  /** Recorded as the profile's `searchesVersion` once the swap is done. */
  searchesVersion: number;
  /** Every stored search switch; the swap is skipped if the row no longer has them all. */
  switches: SwitchFlags;
};
