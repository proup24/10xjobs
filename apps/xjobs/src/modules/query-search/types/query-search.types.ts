import type {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';

export type RankedSkill = {
  technology: Technology;
  importance: number;
  preference: number;
  mastery: number;
};

export type QuerySearchProfileInput = {
  positions: Position[];
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
  locationRegion: Region;
  country: string | null;
  city: string | null;
  experience: Seniority;
  type: Arrangement;
  technologies: Technology[];
};

export type ChannelQuery = {
  keywords: string[];
  params: Record<string, unknown>;
};

/** `position` builds the keywords and is not stored as a column. */
export type QuerySearchRecipe = QuerySearchCombination &
  ChannelQuery & { version: number; hash: string };
