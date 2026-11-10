import { z } from 'zod';
import { NOTICE_OPTIONS, TIMEZONE_OFFSETS } from './options';

/** Answers of each setup step, as the forms hold them. Zod checks them before every save. */

const code = z.string().trim().min(1);
const currency = z.string().regex(/^[A-Z]{3}$/, 'Pick a currency');
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is an absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Indexes of entries whose key was already seen earlier in the list. */
function repeats<T>(items: readonly T[], key: (item: T) => string): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  items.forEach((item, i) => {
    const k = key(item);
    if (seen.has(k)) out.push(i);
    seen.add(k);
  });
  return out;
}

// Step 1

export const LINK_KINDS = [
  'github',
  'gitlab',
  'portfolio',
  'website',
  'other',
] as const;

const aboutShape = {
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name')
    .max(200, 'Use at most 200 characters'),
  phone: z.string().trim().min(1).nullable(),
  linkedin: z.string().trim().min(1).nullable(),
  links: z.array(
    z.object({
      kind: z.enum(LINK_KINDS),
      value: z
        .string()
        .trim()
        .refine(isHttpUrl, 'Enter a link starting with http:// or https://'),
    }),
  ),
};

function noRepeatedLinks(
  about: { links: { kind: string; value: string }[] },
  ctx: z.RefinementCtx,
) {
  for (const i of repeats(about.links, (l) => `${l.kind} ${l.value}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['links', i, 'value'],
      message: 'This link is already listed',
    });
  }
}

export const aboutSchema = z.object(aboutShape).superRefine(noRepeatedLinks);

/** Step 1 without the name: what Preferences saves. */
export const contactsSchema = z
  .object({
    phone: aboutShape.phone,
    linkedin: aboutShape.linkedin,
    links: aboutShape.links,
  })
  .superRefine(noRepeatedLinks);

export type AboutAnswers = z.infer<typeof aboutSchema>;

// Step 2

export const AUTHORIZATION_KINDS = [
  'citizenship',
  'residency',
  'work-permit',
  'clearance',
] as const;
export type AuthorizationKind = (typeof AUTHORIZATION_KINDS)[number];

export const eligibilitySchema = z
  .object({
    residenceCountry: code,
    acceptsSponsorship: z.boolean(),
    authorizations: z.array(
      z.object({ kind: z.enum(AUTHORIZATION_KINDS), place: code }),
    ),
    noneConfirmed: z.boolean(),
  })
  .superRefine((e, ctx) => {
    if (e.authorizations.length === 0 && !e.noneConfirmed) {
      ctx.addIssue({
        code: 'custom',
        path: ['noneConfirmed'],
        message: 'Add a work authorization, or tick that you hold none',
      });
    }
    for (const i of repeats(e.authorizations, (a) => `${a.kind} ${a.place}`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizations', i],
        message: 'This authorization is already listed',
      });
    }
  });

export type EligibilityAnswers = z.infer<typeof eligibilitySchema>;

// Step 3

export const LANGUAGE_LEVELS = ['native', 'fluent', 'working'] as const;
export const MAX_STARRED = 2;

const techShape = z.object({
  code,
  rating: z.literal([1, 2, 3, 4, 5]).nullable(),
  starred: z.boolean(),
});

export type TechAnswer = z.infer<typeof techShape>;

/** Step 3's shape alone; `jobSchema` adds the rules. */
export const jobShape = z.object({
  position: code,
  yearsOfExperience: z
    .number()
    .int('Use whole years')
    .min(0, 'Use 0 to 60 years')
    .max(60, 'Use 0 to 60 years'),
  seniorities: z.array(code).min(1, 'Pick at least one seniority'),
  techs: z.array(techShape),
  languages: z
    .array(z.object({ lang: code, level: z.enum(LANGUAGE_LEVELS) }))
    .min(1, 'Add at least one language'),
});

export type JobAnswers = z.infer<typeof jobShape>;

/**
 * Step 3 with its rules. The rating message is generic: the form shows "Rate <label>",
 * since only it knows the tech's label.
 */
export function jobSchema(isSearchable: (code: string) => boolean) {
  return jobShape.superRefine((job, ctx) => {
    const dupes = new Set(repeats(job.techs, (t) => t.code));
    let starred = 0;
    job.techs.forEach((tech, i) => {
      if (tech.rating === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['techs', i, 'rating'],
          message: 'Rate this tech',
        });
      }
      if (dupes.has(i)) {
        ctx.addIssue({
          code: 'custom',
          path: ['techs', i, 'code'],
          message: 'This tech is already listed',
        });
      }
      if (!tech.starred) return;
      if (!isSearchable(tech.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['techs', i, 'starred'],
          message: 'We can’t search for this tech',
        });
      } else if (++starred > MAX_STARRED) {
        ctx.addIssue({
          code: 'custom',
          path: ['techs', i, 'starred'],
          message: 'Search for at most two techs',
        });
      }
    });
    if (!job.techs.some((t) => isSearchable(t.code))) {
      ctx.addIssue({
        code: 'custom',
        path: ['techs'],
        message: 'Add at least one tech we can search for',
      });
    }
    for (const i of repeats(job.languages, (l) => l.lang)) {
      ctx.addIssue({
        code: 'custom',
        path: ['languages', i, 'lang'],
        message: 'This language is already listed',
      });
    }
  });
}

// Step 4

/** A location place, in exactly the JSON `assert_places` accepts. */
export const placeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worldwide') }),
  z.object({ kind: z.enum(['region', 'country']), code }),
  z.object({ kind: z.literal('city'), id: z.string().regex(UUID) }),
]);

export type Place = z.infer<typeof placeSchema>;

/** One key per distinct place; city ids are uuids, matched in any case as the database does. */
export function placeKey(place: Place): string {
  switch (place.kind) {
    case 'worldwide':
      return 'worldwide';
    case 'city':
      return `city ${place.id.toLowerCase()}`;
    default:
      return `${place.kind} ${place.code}`;
  }
}

export const ARRANGEMENTS = ['remote', 'hybrid', 'onsite'] as const;
export type ArrangementKey = (typeof ARRANGEMENTS)[number];
const ARRANGEMENT_LABELS: Record<ArrangementKey, string> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'on-site',
};
export const MAX_PLACES_PER_ARRANGEMENT = 20;

/** A UTC offset in minutes, one the step 4 Selects offer. */
const offset = z
  .number()
  .refine((m) => TIMEZONE_OFFSETS.includes(m), 'Pick a UTC offset');

const placeRowShape = z.object({
  place: placeSchema,
  remote: z.boolean(),
  hybrid: z.boolean(),
  onsite: z.boolean(),
});

export type PlaceRow = z.infer<typeof placeRowShape>;

/** Step 4's shape alone; `termsSchema` adds the rules. */
export const termsShape = z.object({
  places: z.array(placeRowShape).min(1, 'Add at least one place'),
  timezoneCurrent: offset,
  timezoneMin: offset,
  timezoneMax: offset,
  contractTypes: z.array(code).min(1, 'Pick at least one contract type'),
  engagements: z.array(code).min(1, 'Pick at least one way to be hired'),
  noticePeriodDays: z.number().int(),
  salary: z
    .object({
      min: z
        .number()
        .int('Use a whole amount')
        .positive('Use an amount above 0'),
      currency,
      period: z.enum(['hour', 'day', 'month', 'year']),
    })
    .nullable(),
  acceptsAnyCurrency: z.boolean(),
  acceptedCurrencies: z.array(currency),
});

export type TermsAnswers = z.infer<typeof termsShape>;

export const termsSchema = termsShape.superRefine((t, ctx) => {
  const dupes = new Set(repeats(t.places, (r) => placeKey(r.place)));
  t.places.forEach((row, i) => {
    if (!row.remote && !row.hybrid && !row.onsite) {
      ctx.addIssue({
        code: 'custom',
        path: ['places', i],
        message: 'Pick remote, hybrid or on-site',
      });
    }
    if (row.place.kind === 'worldwide') {
      for (const a of ['hybrid', 'onsite'] as const) {
        if (row[a]) {
          ctx.addIssue({
            code: 'custom',
            path: ['places', i, a],
            message: 'Worldwide is remote only',
          });
        }
      }
    }
    if (row.place.kind === 'region' && row.place.code === 'GLOBAL') {
      ctx.addIssue({
        code: 'custom',
        path: ['places', i, 'place'],
        message: 'Use worldwide instead',
      });
    } else if (dupes.has(i)) {
      ctx.addIssue({
        code: 'custom',
        path: ['places', i, 'place'],
        message: 'This place is already listed',
      });
    }
  });
  for (const a of ARRANGEMENTS) {
    if (t.places.filter((r) => r[a]).length > MAX_PLACES_PER_ARRANGEMENT) {
      ctx.addIssue({
        code: 'custom',
        path: ['places'],
        message: `Pick at most ${MAX_PLACES_PER_ARRANGEMENT} ${ARRANGEMENT_LABELS[a]} places`,
      });
    }
  }
  if (t.timezoneMin > t.timezoneMax) {
    ctx.addIssue({
      code: 'custom',
      path: ['timezoneMax'],
      message: 'End the range at or after its start',
    });
  }
  if (!NOTICE_OPTIONS.some((o) => o.days === t.noticePeriodDays)) {
    ctx.addIssue({
      code: 'custom',
      path: ['noticePeriodDays'],
      message: 'Pick a notice period',
    });
  }
  if (t.acceptsAnyCurrency && t.acceptedCurrencies.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['acceptedCurrencies'],
      message: 'Clear the currencies, or turn off "Any currency"',
    });
  }
  if (!t.acceptsAnyCurrency && t.acceptedCurrencies.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['acceptedCurrencies'],
      message: 'Pick at least one currency',
    });
  }
});

// Draft

/**
 * Steps 3 and 4 as entered, before the profile exists. Only the shape is checked here:
 * the rules run again on the next save, so a tech that stopped being searchable
 * doesn't throw the draft away.
 */
const draftSchema = z.object({
  version: z.literal(1),
  job: jobShape.optional(),
  terms: termsShape.optional(),
});

export type SetupDraft = { version: 1; job?: JobAnswers; terms?: TermsAnswers };

/** The stored draft, or null when it doesn't match this version (the step starts over). */
export function parseDraft(json: unknown): SetupDraft | null {
  const r = draftSchema.safeParse(json);
  return r.success ? r.data : null;
}

const newProfileDraftSchema = z.object({
  version: z.literal(2),
  newProfileId: z.string().regex(UUID),
  copyFrom: z.string().regex(UUID).nullable(),
  job: jobShape.optional(),
  terms: termsShape.optional(),
});

/** A new-profile flow's answers, kept in the same draft row as setup's but as version 2. */
export type NewProfileDraft = {
  version: 2;
  newProfileId: string;
  copyFrom: string | null;
  job?: JobAnswers;
  terms?: TermsAnswers;
};

/** The stored new-profile draft, or null for any other version or shape. */
export function parseNewProfileDraft(json: unknown): NewProfileDraft | null {
  const r = newProfileDraftSchema.safeParse(json);
  return r.success ? r.data : null;
}
