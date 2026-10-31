import type {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';

export type RankedSkill = {
  technology: Technology;
  domain: SkillDomain;
  importance: number;
  mastery: number;
};

/** The technologies one search uses and the skill domain they came from. */
export type TechnologySet = {
  technologies: Technology[];
  domain: SkillDomain;
};

export type QuerySearchProfileInput = {
  position: Position;
  regions: Region[];
  arrangements: Arrangement[];
  seniority: Seniority;
  country: string;
  city: string | null;
  skills: RankedSkill[];
};

export type QuerySearchCombination = {
  channel: Channel;
  position: Position;
  /** Null for onsite and hybrid: those are bound to the city, not a region. */
  locationRegion: Region | null;
  country: string | null;
  city: string | null;
  experience: Seniority;
  type: Arrangement;
  technologies: Technology[];
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
