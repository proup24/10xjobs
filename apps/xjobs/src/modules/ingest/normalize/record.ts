import { z } from 'zod';

/**
 * Bump on any change to a mapper or the job key; then run `db:renormalize`.
 * Version 5 adds city, state, geoId and salary.providedByEmployer. No
 * `db:renormalize` is needed for old items: they stay null until re-collected.
 * Version 6 keys a LinkedIn job by its apply URL alone (the title is no longer
 * part of a `url:` key); run `db:renormalize`.
 * Version 7 builds LinkedIn job-board description text from the HTML, so its
 * line breaks survive; run `db:renormalize` once (it sends nothing to Process).
 * Version 8 maps LinkedIn posts to `kind: 'post'` records with a `post` object;
 * run `db:renormalize`.
 * Version 9 reads a share's nested original (with its own attachments) so a
 * share or repost joins its original's job, and reads a post's attached
 * LinkedIn job as a link; run `db:renormalize`.
 */
export const NORMALIZER_VERSION = 9;

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

const postAuthorSchema = z.strictObject({
  key: text,
  name: text,
  profileUrl: url.nullable(),
  headline: text,
  type: z.enum(['person', 'company']).nullable(),
});

/** The emails and links a post carries, sorted by what can be done with them. */
const postLinksSchema = z.strictObject({
  emails: z.array(z.string().min(1)),
  linkedinJobIds: z.array(z.string().min(1)),
  atsPostings: z.array(
    z.strictObject({
      provider: z.enum(['ashby', 'greenhouse']),
      url: z.string().min(1),
    }),
  ),
  other: z.array(z.string().min(1)),
});

/** The post a repost shares. */
const postOriginalSchema = z.strictObject({
  id: text,
  url: url.nullable(),
  author: postAuthorSchema.nullable(),
  text: text,
  /** The actor cut the original's text at "see more". */
  truncated: z.boolean(),
  /** The original's links that are not in its text. */
  attachedUrls: z.array(z.string().min(1)),
  postedAt: z.iso.datetime().nullable(),
});

/** What a post record knows about the post itself. */
export const postDetailSchema = z.strictObject({
  id: z.string().min(1),
  url: url,
  author: postAuthorSchema,
  /** This post's own cleaned text (a share's added text). */
  text: text,
  /**
   * The actor cut this post's own text at "see more". Missing (false) on a
   * record stored before the field existed.
   */
  truncated: z.boolean(),
  /**
   * The payload's links that are not in its text (the article link). Missing
   * ([]) on a record stored before the field existed.
   */
  attachedUrls: z.array(z.string().min(1)),
  postedAt: z.iso.datetime().nullable(),
  original: postOriginalSchema.nullable(),
  links: postLinksSchema,
});

export type PostAuthor = z.infer<typeof postAuthorSchema>;
export type PostOriginal = z.infer<typeof postOriginalSchema>;
export type PostDetail = z.infer<typeof postDetailSchema>;

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
    post: postDetailSchema.nullable(),
    closed: z.boolean(),
  })
  .refine((r) => r.kind !== 'post' || r.post !== null, {
    message: 'a post record needs its post',
    path: ['post'],
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
  'post',
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
