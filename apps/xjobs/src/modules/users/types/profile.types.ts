import type {
  Arrangement,
  Engagement,
  Language,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import type { ProfileRow, ProfileSkillRow } from 'src/database';

export type ProfileInput = {
  positions: Position[];
  languages: Language[];
  country: string;
  city: string | null;
  regions: Region[];
  yearsOfExperience: number;
  timezoneCurrent: number;
  timezoneMin: number;
  timezoneMax: number;
  engagements: Engagement[];
  arrangements: Arrangement[];
  seniority: Seniority;
  noticePeriodDays: number;
};

export type SkillInput = {
  technology: Technology;
  domain: SkillDomain;
  mastery: number;
  preference: number;
  importance: number;
};

export type ProfileWithSkills = ProfileRow & { techStack: ProfileSkillRow[] };

export type ProfileView = Omit<
  ProfileRow,
  | 'resumeKey'
  | 'resumeFilename'
  | 'resumeSizeBytes'
  | 'resumeSha256'
  | 'resumeUploadedAt'
> & {
  techStack: Pick<
    ProfileSkillRow,
    'technology' | 'domain' | 'mastery' | 'preference' | 'importance'
  >[];
  resume: {
    filename: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: Date;
  } | null;
};
