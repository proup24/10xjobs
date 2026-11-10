import { SkillDomain } from '@xjobs/database/enums';
import type { Database } from '@xjobs/database/types';
import { z } from 'zod';
import {
  ARRANGEMENTS,
  LANGUAGE_LEVELS,
  placeKey,
  placeSchema,
  type JobAnswers,
  type Place,
  type PlaceRow,
  type TechAnswer,
  type TermsAnswers,
} from './answers';
import {
  nearestNotice,
  snapOffset,
  snapOffsetDown,
  snapOffsetUp,
} from './options';

/** Setup answers ↔ `profiles` and `profile_skills` rows. */

type Tables = Database['public']['Tables'];
export type ProfileRow = Tables['profiles']['Row'];
export type SkillRow = Tables['profile_skills']['Row'];

export type Locations = Record<(typeof ARRANGEMENTS)[number], Place[]>;

/** Exactly the `p_profile` keys `create_profile_from_setup` reads. */
export type ProfileWrite = Omit<
  Pick<
    ProfileRow,
    | 'position'
    | 'yearsOfExperience'
    | 'timezoneCurrent'
    | 'timezoneMin'
    | 'timezoneMax'
    | 'engagements'
    | 'seniorities'
    | 'noticePeriodDays'
    | 'contractTypes'
    | 'locations'
    | 'languages'
    | 'salaryMin'
    | 'salaryCurrency'
    | 'salaryPeriod'
    | 'acceptsAnyCurrency'
    | 'acceptedCurrencies'
  >,
  'locations' | 'languages'
> & { locations: Locations; languages: JobAnswers['languages'] };

export type SkillWrite = Pick<
  SkillRow,
  'technology' | 'domain' | 'mastery' | 'importance'
>;

type Rating = NonNullable<TechAnswer['rating']>;

const DOMAIN_BY_POSITION: Readonly<Record<string, SkillDomain>> = {
  backend_engineer: SkillDomain.backend,
  frontend_engineer: SkillDomain.frontend,
  fullstack_engineer: SkillDomain.fullstack,
  mobile_engineer: SkillDomain.mobile,
  devops_engineer: SkillDomain.devops,
  site_reliability_engineer: SkillDomain.devops,
  platform_engineer: SkillDomain.devops,
  cloud_engineer: SkillDomain.devops,
  data_engineer: SkillDomain.data,
  ml_engineer: SkillDomain.ml,
  ai_engineer: SkillDomain.ml,
  security_engineer: SkillDomain.security,
  qa_engineer: SkillDomain.qa,
};

/** The domain every skill takes from the position; anything unlisted is backend. */
export function domainFor(position: string): SkillDomain {
  return Object.hasOwn(DOMAIN_BY_POSITION, position)
    ? DOMAIN_BY_POSITION[position]
    : SkillDomain.backend;
}

export const ratingToMastery = (rating: Rating): number => rating * 2;

export const masteryToRating = (mastery: number): Rating =>
  Math.min(5, Math.max(1, Math.round(mastery / 2))) as Rating;

export const DEFAULT_IMPORTANCE = 5;

/** The profile columns step 3 owns. */
export function jobColumns(
  job: JobAnswers,
): Pick<
  ProfileWrite,
  'position' | 'yearsOfExperience' | 'seniorities' | 'languages'
> {
  return {
    position: job.position,
    yearsOfExperience: job.yearsOfExperience,
    seniorities: job.seniorities,
    languages: job.languages.map(({ lang, level }) => ({ lang, level })),
  };
}

/** Step 3's techs as skill rows; every tech must be rated (the schema guarantees it). */
export function jobSkills(job: JobAnswers): SkillWrite[] {
  const domain = domainFor(job.position);
  return job.techs.map((tech) => {
    if (tech.rating === null) {
      throw new Error(`tech ${tech.code} has no rating`);
    }
    return {
      technology: tech.code,
      domain,
      mastery: ratingToMastery(tech.rating),
      importance: DEFAULT_IMPORTANCE,
    };
  });
}

/** A fresh place object, so no stray key reaches the database. */
function placeJson(place: Place): Place {
  switch (place.kind) {
    case 'city':
      return { kind: 'city', id: place.id };
    default:
      return { kind: place.kind, code: place.code };
  }
}

/** The profile columns step 4 owns. Without a salary its three keys are null. */
export function termsColumns(
  terms: TermsAnswers,
): Omit<ProfileWrite, keyof ReturnType<typeof jobColumns>> {
  const locations: Locations = { remote: [], hybrid: [], onsite: [] };
  for (const row of terms.places) {
    for (const a of ARRANGEMENTS) {
      if (row[a]) locations[a].push(placeJson(row.place));
    }
  }
  return {
    timezoneCurrent: terms.timezoneCurrent,
    timezoneMin: terms.timezoneMin,
    timezoneMax: terms.timezoneMax,
    engagements: terms.engagements,
    noticePeriodDays: terms.noticePeriodDays,
    contractTypes: terms.contractTypes,
    locations,
    salaryMin: terms.salary?.min ?? null,
    salaryCurrency: terms.salary?.currency ?? null,
    salaryPeriod: terms.salary?.period ?? null,
    acceptsAnyCurrency: terms.acceptsAnyCurrency,
    acceptedCurrencies: terms.acceptedCurrencies,
  };
}

/** The `create_profile_from_setup` arguments for validated answers. */
export function toProfileWrite(
  job: JobAnswers,
  terms: TermsAnswers,
): { profile: ProfileWrite; skills: SkillWrite[] } {
  return {
    profile: { ...jobColumns(job), ...termsColumns(terms) },
    skills: jobSkills(job),
  };
}

// Reading back. A profile may come from outside setup (engine, seeds), so this
// tolerates values setup never writes and drops what the forms can't show.

const UNSTATED = 'unstated';
const withoutUnstated = (codes: string[]) =>
  codes.filter((c) => c !== UNSTATED);

const languageEntry = z.object({
  lang: z.string().min(1),
  level: z.enum(LANGUAGE_LEVELS),
});

function readLanguages(json: ProfileRow['languages']): JobAnswers['languages'] {
  if (!Array.isArray(json)) return [];
  const out: JobAnswers['languages'] = [];
  for (const entry of json) {
    const r = languageEntry.safeParse(entry);
    if (r.success && !out.some((l) => l.lang === r.data.lang)) {
      out.push(r.data);
    }
  }
  return out;
}

/**
 * One tech row per technology (the engine may store one under several domains, keeping
 * the highest mastery).
 */
function readTechs(skills: SkillRow[]): TechAnswer[] {
  const mastery = new Map<string, number>();
  for (const s of skills) {
    mastery.set(
      s.technology,
      Math.max(mastery.get(s.technology) ?? -Infinity, s.mastery),
    );
  }
  return [...mastery].map(([code, m]) => ({
    code,
    rating: masteryToRating(m),
  }));
}

/** Place rows by identity, in first-seen order. */
export function readPlaces(json: ProfileRow['locations']): PlaceRow[] {
  const rows = new Map<string, PlaceRow>();
  const lists =
    json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  for (const a of ARRANGEMENTS) {
    const list = lists[a];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const r = placeSchema.safeParse(entry);
      if (!r.success) continue;
      const place =
        r.data.kind === 'city'
          ? { kind: 'city' as const, id: r.data.id.toLowerCase() }
          : placeJson(r.data);
      const key = placeKey(place);
      const row = rows.get(key) ?? {
        place,
        remote: false,
        hybrid: false,
        onsite: false,
      };
      row[a] = true;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

const SALARY_PERIODS = ['hour', 'day', 'month', 'year'] as const;
type SalaryPeriod = (typeof SALARY_PERIODS)[number];
const isSalaryPeriod = (p: string | null): p is SalaryPeriod =>
  (SALARY_PERIODS as readonly (string | null)[]).includes(p);

/** The answers for steps 3 and 4 from a stored profile and its skills. */
export function fromProfile(
  row: ProfileRow,
  skills: SkillRow[],
): { job: JobAnswers; terms: TermsAnswers } {
  const { salaryMin, salaryCurrency, salaryPeriod } = row;
  return {
    job: {
      position: row.position,
      yearsOfExperience: row.yearsOfExperience,
      seniorities: withoutUnstated(row.seniorities),
      techs: readTechs(skills),
      languages: readLanguages(row.languages),
    },
    terms: {
      places: readPlaces(row.locations),
      // Snapped into the offered list: the range outward, so it never narrows.
      timezoneCurrent: snapOffset(row.timezoneCurrent),
      timezoneMin: snapOffsetDown(row.timezoneMin),
      timezoneMax: snapOffsetUp(row.timezoneMax),
      contractTypes: withoutUnstated(row.contractTypes),
      engagements: withoutUnstated(row.engagements),
      noticePeriodDays: nearestNotice(row.noticePeriodDays),
      salary:
        salaryMin !== null &&
        salaryCurrency !== null &&
        isSalaryPeriod(salaryPeriod)
          ? { min: salaryMin, currency: salaryCurrency, period: salaryPeriod }
          : null,
      acceptsAnyCurrency: row.acceptsAnyCurrency,
      acceptedCurrencies: row.acceptedCurrencies,
    },
  };
}
