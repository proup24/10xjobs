import type { SkillDomain } from 'src/common/enums';
import type { ProfileRow, ProfileSkillRow } from 'src/database';
import type { QuerySearchAttachResult } from 'src/modules/queries';
import type {
  PlacesByArrangement,
  Salary,
  SpokenLanguage,
} from './place.types';

/**
 * A profile as the engine writes it. Codes are plain strings: the database's
 * code-check triggers decide which ones are approved.
 */
export type ProfileInput = {
  /** A role_kinds code. */
  position: string;
  locations: PlacesByArrangement;
  languages: SpokenLanguage[];
  yearsOfExperience: number;
  timezoneCurrent: number;
  timezoneMin: number;
  timezoneMax: number;
  /** engagements codes. */
  engagements: string[];
  /** seniorities codes. */
  seniorities: string[];
  /** contract_types codes. */
  contractTypes: string[];
  /** Written to `salaryMin`, `salaryCurrency` and `salaryPeriod`; null for no salary rule. */
  salary: Salary | null;
  acceptsAnyCurrency: boolean;
  /** ISO 4217 codes; empty exactly when any currency is accepted. */
  acceptedCurrencies: string[];
  noticePeriodDays: number;
};

export type SkillInput = {
  /** A tech_tags code. */
  technology: string;
  domain: SkillDomain;
  mastery: number;
  importance: number;
};

export type ProfileWithSkills = ProfileRow & { techStack: ProfileSkillRow[] };

/** Columns the API does not show as stored: it types the jsonb ones, and groups the salary and resume ones. */
export type HiddenProfileColumns =
  | 'resumeKey'
  | 'resumeFilename'
  | 'resumeSizeBytes'
  | 'resumeSha256'
  | 'resumeUploadedAt'
  | 'locations'
  | 'languages'
  | 'contractTypes'
  | 'salaryMin'
  | 'salaryCurrency'
  | 'salaryPeriod'
  | 'postSearch';

export type ProfileView = Omit<ProfileRow, HiddenProfileColumns> & {
  locations: PlacesByArrangement;
  languages: SpokenLanguage[];
  contractTypes: string[];
  salary: Salary | null;
  techStack: Pick<
    ProfileSkillRow,
    'technology' | 'domain' | 'mastery' | 'importance'
  >[];
  resume: {
    filename: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: Date;
  } | null;
};

export type PublishedProfileView = ProfileView & {
  querySearches: QuerySearchAttachResult;
};

/** The post search switch as the web app reads it. */
export type PostSearchView = {
  enabled: boolean;
  /** Whether the owner is on the engine's allow-list. */
  allowed: boolean;
  /** How many LinkedIn post searches the profile would get. */
  searches: number;
};
