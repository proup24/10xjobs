import { z } from 'zod';
import {
  JUNK_REASONS,
  NOT_HIRING_REASONS,
  VERDICTS,
  type Verdict,
} from '@xjobs/database/enums';
import { confidenceSchema } from './fact';
import { extractionDocumentSchema } from './extraction';
import { buildModelOutput, type ListOptions } from './model-output';

export const POST_SCHEMA_VERSION = 1;

// The verdict codes live in the shared enums, so the web filters on the same lists.
export { JUNK_REASONS, NOT_HIRING_REASONS, VERDICTS, type Verdict };

export const APPLY_KINDS = [
  'email',
  'external_link',
  'linkedin_job',
  'connect_dm_comment',
  'unstated',
] as const;
export const AUTHOR_RELATIONS = ['employer', 'recruiter', 'unstated'] as const;
export const CONFIDENCES = ['sure', 'unsure'] as const;

export type ApplyKind = (typeof APPLY_KINDS)[number];

const verdictSchema = z.strictObject({
  value: z.enum(VERDICTS),
  reason: z.enum([
    'hiring',
    ...NOT_HIRING_REASONS,
    ...JUNK_REASONS.filter((r) => r !== 'other'),
  ]),
  quote: z.string(),
  confidence: confidenceSchema,
});

const employerSchema = z.strictObject({
  name: z.string().min(1).nullable(),
  quote: z.string(),
});

const howToApplySchema = z.strictObject({
  kinds: z.array(z.enum(APPLY_KINDS)).min(1),
  email: z.string().min(1).nullable(),
  emailQuote: z.string(),
  links: z.array(z.string().min(1)),
  quote: z.string(),
});

const roleFields = {
  employer: employerSchema,
  authorRelation: z.enum(AUTHOR_RELATIONS),
  howToApply: howToApplySchema,
};

/**
 * What the generator returns for a post: the verdict and one entry per role,
 * each the listing model output plus the post-only fields. Cross-field rules
 * live in postDocumentSchema, so this converts cleanly to a JSON schema.
 */
export function postModelOutputSchema(options: ListOptions) {
  return z.strictObject({
    verdict: verdictSchema,
    roles: z.array(buildModelOutput(options).extend(roleFields)),
  });
}

export type PostModelOutput = z.infer<ReturnType<typeof postModelOutputSchema>>;

function reasonBelongs(value: Verdict, reason: string): boolean {
  if (value === 'hiring') return reason === 'hiring';
  const allowed: readonly string[] =
    value === 'not_hiring' ? NOT_HIRING_REASONS : JUNK_REASONS;
  return allowed.includes(reason);
}

/** Stored `data` of a post extraction (docType = 'post'). */
export const postDocumentSchema = z
  .strictObject({
    verdict: verdictSchema,
    roles: z.array(
      z.strictObject({
        roleKey: z.string().min(1),
        title: z.string(),
        ...roleFields,
        facts: extractionDocumentSchema,
      }),
    ),
    truncated: z.boolean(),
    models: z.strictObject({ generator: z.string().min(1) }),
  })
  .superRefine((doc, ctx) => {
    const { value, reason } = doc.verdict;
    if (!reasonBelongs(value, reason)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict', 'reason'],
        message: `reason ${reason} does not belong to verdict ${value}`,
      });
    }
    if (value === 'hiring' && doc.roles.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['roles'],
        message: 'a hiring post has at least one role',
      });
    }
    if (value !== 'hiring' && doc.roles.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['roles'],
        message: `a ${value} post has no roles`,
      });
    }
    doc.roles.forEach((role, i) => {
      const { kinds, email } = role.howToApply;
      const path = ['roles', i, 'howToApply'];
      if (kinds.includes('unstated') && kinds.length > 1) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'kinds'],
          message: 'unstated stands alone',
        });
      }
      const linkKind =
        kinds.includes('external_link') || kinds.includes('linkedin_job');
      if (linkKind !== role.howToApply.links.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'links'],
          message:
            'links are set exactly when kinds includes external_link or linkedin_job',
        });
      }
      if (kinds.includes('email') !== (email !== null)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'email'],
          message: 'email is set exactly when kinds includes email',
        });
      }
    });
  });

export type PostDocument = z.infer<typeof postDocumentSchema>;
