import { z } from 'zod';

/**
 * Bump on any change to a mapper or the job key; then run `db:renormalize`.
 * Version 5 adds city, state, geoId and salary.providedByEmployer. No
 * `db:renormalize` is needed for old items: they stay null until re-collected.
 */
export const NORMALIZER_VERSION = 5;

const text = z.string().min(1).nullable();
const url = z.url({ protocol: /^https?$/ });

/** A LinkedIn company page's facts, as the harvestapi actor returns them. */
export const normalizedCompanySchema = z.strictObject({
  linkedinId: z.string().min(1),
  universalName: text,
  name: text,
  linkedinUrl: url.nullable(),
  website: url.nullable(),
  employeeCount: z.number().int().nonnegative().nullable(),
  employeeCountMin: z.number().int().nonnegative().nullable(),
  employeeCountMax: z.number().int().nonnegative().nullable(),
  industries: z.array(z.string().min(1)),
  specialities: z.array(z.string().min(1)),
  description: text,
  headquartersCountryCode: text,
});

export type NormalizedCompany = z.infer<typeof normalizedCompanySchema>;

/**
 * The unified job format, shaped like the LinkedIn job board (the most
 * complete channel). Every field is an exact fact from the source, or null.
 */
export const normalizedRecordSchema = z
  .strictObject({
    kind: z.enum(['job', 'post']),
    title: text,
    companyName: text,
    companyUrl: url.nullable(),
    location: text,
    contractType: text,
    experienceLevel: text,
    sector: text,
    salary: z
      .strictObject({
        text: text,
        min: z.number().nullable(),
        max: z.number().nullable(),
        currency: text,
        period: text,
        providedByEmployer: z.boolean().nullable(),
      })
      .nullable(),
    publishedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    postedAt: z.iso.datetime().nullable(),
    descriptionHtml: text,
    descriptionText: text,
    applyUrl: url.nullable(),
    postingUrl: url,
    poster: z
      .strictObject({
        name: text,
        profileUrl: url.nullable(),
        type: z.enum(['person', 'company']).nullable(),
      })
      .nullable(),
    workplaceType: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
    remoteAllowed: z.boolean().nullable(),
    employmentType: text,
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    regionCode: text,
    city: text,
    state: text,
    geoId: text,
    applicantTrackingSystem: text,
    applicantCount: z.number().int().nonnegative().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    listingState: text,
    company: normalizedCompanySchema.nullable(),
    closed: z.boolean(),
  })
  .refine((r) => r.closed || r.title !== null || r.descriptionText !== null, {
    message: 'a title or a description is required',
    path: ['title'],
  });

export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>;

/** Field order of a record: canonical JSON and merging both follow it. */
export const RECORD_FIELDS = [
  'kind',
  'title',
  'companyName',
  'companyUrl',
  'location',
  'contractType',
  'experienceLevel',
  'sector',
  'salary',
  'publishedAt',
  'postedAt',
  'descriptionHtml',
  'descriptionText',
  'applyUrl',
  'postingUrl',
  'poster',
  'workplaceType',
  'remoteAllowed',
  'employmentType',
  'countryCode',
  'regionCode',
  'city',
  'state',
  'geoId',
  'applicantTrackingSystem',
  'applicantCount',
  'expiresAt',
  'listingState',
  'company',
  'closed',
] as const satisfies readonly (keyof NormalizedRecord)[];

export type NormalizeResult =
  | { record: NormalizedRecord }
  | { invalid: string };

/** A record with every field null except the ones given, in field order. */
export function emptyRecord(
  fields: Pick<NormalizedRecord, 'kind' | 'postingUrl'> &
    Partial<NormalizedRecord>,
): NormalizedRecord {
  const base: Record<string, unknown> = {};
  for (const field of RECORD_FIELDS)
    base[field] = fields[field] ?? (field === 'closed' ? false : null);
  return base as NormalizedRecord;
}
