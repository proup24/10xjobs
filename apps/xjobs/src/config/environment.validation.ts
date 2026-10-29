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

export const environmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: z.enum(EnvironmentType).default(EnvironmentType.development),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  SYSTEM_DOMAIN: z.string().min(1).default('localhost'),
  SENTRY_DSN: z.url().optional(),
  COOKIE_DOMAIN: z.string().min(1).optional(),
  COOKIE_SECURE: booleanFlag.optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** Where uploaded resume PDFs are written. Keep it out of git. */
  RESUME_STORAGE_DIR: z.string().min(1).default('./storage/resumes'),
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
