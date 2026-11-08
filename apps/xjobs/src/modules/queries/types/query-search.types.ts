import { Arrangement, type Channel, type SkillDomain } from 'src/common/enums';

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

export type QuerySearchProfileInput = {
  position: string;
  locations: LocationsByArrangement;
  seniorities: string[];
  skills: RankedSkill[];
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
