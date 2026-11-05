import { z } from 'zod';
import { EnvironmentType } from './environment-type';
import { loadEnvironmentFiles } from './environment.loader';

/**
 * @description Environment variables are strings; this parses the usual
 * spellings of a boolean instead of treating every non-empty string as `true`.
 */
export const booleanFlag = z
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

/** What standalone scripts (the seed runner) read: the database plus the environment type. */
export const seedEnvironmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: z.enum(EnvironmentType).default(EnvironmentType.development),
  /** The users seed creates auth users through the Supabase admin API. */
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type DatabaseEnvironmentVariables = z.infer<
  typeof databaseEnvironmentSchema
>;
export type SeedEnvironmentVariables = z.infer<typeof seedEnvironmentSchema>;

export interface DatabaseConfig {
  url: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  slowQueryMs: number;
  logQueries: boolean;
}

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

export function toDatabaseConfig(
  env: DatabaseEnvironmentVariables,
): DatabaseConfig {
  return {
    url: env.DATABASE_URL,
    connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
    slowQueryMs: env.DATABASE_SLOW_QUERY_MS,
    logQueries: env.DATABASE_LOG_QUERIES,
  };
}

/**
 * @description For code running outside Nest (seeds, scripts): loads the env
 * files and validates only the database variables.
 */
export function loadDatabaseEnvironment(): DatabaseEnvironmentVariables {
  loadEnvironmentFiles();
  return parseEnvironment(databaseEnvironmentSchema, process.env);
}

/**
 * @description For the seed runner: loads the env files and validates the
 * database variables plus `NODE_ENV`.
 */
export function loadSeedEnvironment(): SeedEnvironmentVariables {
  loadEnvironmentFiles();
  return parseEnvironment(seedEnvironmentSchema, process.env);
}
