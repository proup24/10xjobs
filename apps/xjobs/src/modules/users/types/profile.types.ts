import type {
  Engagement,
  Language,
  Position,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import type { ProfileRow, ProfileSkillRow } from 'src/database';
import type {
  LocationsByArrangement,
  QuerySearchAttachResult,
} from 'src/modules/queries';

export type ProfileInput = {
  position: Position;
  languages: Language[];
  country: string;
  city: string | null;
  locations: LocationsByArrangement;
  yearsOfExperience: number;
  timezoneCurrent: number;
  timezoneMin: number;
  timezoneMax: number;
  engagements: Engagement[];
  seniorities: Seniority[];
  noticePeriodDays: number;
};

/** The editable part of a profile: everything but its position. */
export type ProfileFields = Omit<ProfileInput, 'position'>;

export type SkillInput = {
  technology: Technology;
  domain: SkillDomain;
  mastery: number;
  importance: number;
};

export type ProfileWithSkills = ProfileRow & { techStack: ProfileSkillRow[] };

/** Preference columns the questionnaire does not write yet; the API leaves them out until it does. */
export type PreferenceColumns =
  | 'contractTypes'
  | 'places'
  | 'spokenLanguages'
  | 'salaryMin'
  | 'salaryCurrency'
  | 'salaryPeriod'
  | 'acceptsAnyCurrency'
  | 'acceptedCurrencies';

export type ProfileView = Omit<
  ProfileRow,
  | 'resumeKey'
  | 'resumeFilename'
  | 'resumeSizeBytes'
  | 'resumeSha256'
  | 'resumeUploadedAt'
  | 'locations'
  | PreferenceColumns
> & {
  locations: LocationsByArrangement;
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
