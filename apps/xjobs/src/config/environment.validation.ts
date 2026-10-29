import { z } from 'zod';
// Keep Prisma CLI's configuration dependency graph resolvable without aliases.
import { EnvironmentType } from '../common/enums';

/**
 * @description Environment variables are strings; this parses the usual
 * spellings of a boolean instead of treating every non-empty string as `true`.
 */
const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => ['true', '1', 'yes'].includes(value));

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe('postgresql://user:password@host:port/database');

/**
 * @description Variables needed to reach the database. Kept separate so the
 * Prisma CLI config and the seed runner can validate only what they use,
 * without requiring the HTTP server's settings in CI.
 */
export const databaseEnvironmentSchema = z.object({
  /**
   * Runtime connection. On Supabase use the session pooler (port 5432) or the
   * direct connection — never the transaction pooler (6543), which breaks
   * session-level settings the Prisma 8 runtime relies on.
   */
  DATABASE_URL: postgresUrl,
  /** Optional connection for migrations; falls back to `DATABASE_URL`. */
  DIRECT_DATABASE_URL: postgresUrl.optional(),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(20_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_SLOW_QUERY_MS: z.coerce.number().int().nonnegative().default(500),
  DATABASE_LOG_QUERIES: booleanFlag.default(false),
});

export const environmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: z.enum(EnvironmentType).default(EnvironmentType.development),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    SYSTEM_DOMAIN: z.string().min(1).default('localhost'),
    SENTRY_DSN: z.url().optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    COOKIE_SECURE: booleanFlag.optional(),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    /** Credentials every API request must send as HTTP Basic auth. */
    BASIC_AUTH_USERNAME: z.string().min(1),
    BASIC_AUTH_PASSWORD: z
      .string()
      .min(12, 'BASIC_AUTH_PASSWORD must be at least 12 characters'),
    /** Supabase API URL for Storage; falls back to the stack's SUPABASE_PUBLIC_URL. */
    SUPABASE_URL: z.url().optional(),
    SUPABASE_PUBLIC_URL: z.url().optional(),
    /** Service-role key, server-side only; falls back to the stack's SERVICE_ROLE_KEY. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SERVICE_ROLE_KEY: z.string().min(1).optional(),
    /** Private bucket that holds resume PDFs. */
    STORAGE_RESUMES_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{1,62}$/)
      .default('resumes'),
  })
  .superRefine((env, ctx) => {
    if (!env.SUPABASE_URL && !env.SUPABASE_PUBLIC_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)',
      });
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
        message: 'Set SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)',
      });
    }
  });

export type DatabaseEnvironmentVariables = z.infer<
  typeof databaseEnvironmentSchema
>;
export type EnvironmentVariables = z.infer<typeof environmentSchema>;

/**
 * @description Parses `config` against `schema`, failing with every invalid
 * variable listed at once rather than the first one only.
 */
export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  config: Record<string, unknown>,
): z.infer<T> {
  const result = schema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * @description `validate` hook for `ConfigModule.forRoot`.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  return parseEnvironment(environmentSchema, config);
}
