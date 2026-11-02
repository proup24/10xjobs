import { z } from 'zod';
// Keep Prisma CLI's configuration dependency graph resolvable without aliases.
import { Channel, EnvironmentType } from '../common/enums';

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

/** What standalone scripts (the seed runner) read: the database plus the environment type. */
export const seedEnvironmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: z.enum(EnvironmentType).default(EnvironmentType.development),
});

/** Shared by the HTTP API and the standalone queue worker. */
export const redisEnvironmentSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://127.0.0.1:6379'),
  REDIS_CACHE_URL: z
    .url({ protocol: /^rediss?$/ })
    .default('redis://127.0.0.1:6380'),
  REDIS_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('xjobs'),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JOBS_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),
});

/** Supabase Storage credentials, each with the Supabase stack's own fallback name. */
const storageEnvironmentShape = {
  /** Supabase API URL for Storage; falls back to the stack's SUPABASE_PUBLIC_URL. */
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLIC_URL: z.url().optional(),
  /** Service-role key, server-side only; falls back to the stack's SERVICE_ROLE_KEY. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SERVICE_ROLE_KEY: z.string().min(1).optional(),
};

function requireStorage(
  env: {
    SUPABASE_URL?: string;
    SUPABASE_PUBLIC_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SERVICE_ROLE_KEY?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (!env.SUPABASE_URL && !env.SUPABASE_PUBLIC_URL)
    ctx.addIssue({
      code: 'custom',
      path: ['SUPABASE_URL'],
      message: 'Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)',
    });
  if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SERVICE_ROLE_KEY)
    ctx.addIssue({
      code: 'custom',
      path: ['SUPABASE_SERVICE_ROLE_KEY'],
      message: 'Set SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)',
    });
}

/**
 * A worker process. `WORKER_ROLE=ingest` runs the ingest worker,
 * `WORKER_ROLE=processor` runs the processor (needs `OPENROUTER_API_KEY`), and
 * `WORKER_ROLE=all` runs the infrastructure, ingest and every channel's
 * collection worker in one process, plus the processor when
 * `PROCESSOR_ENABLED=true` (it spends money, so it is opt-in there). Otherwise `WORKER_CHANNEL` unset runs the
 * infrastructure worker, and a channel runs that channel's collection job.
 * Collection needs an Apify token. An unknown role or
 * channel fails startup rather than falling back. Every worker needs Supabase
 * Storage, where collection batches are written and read.
 */
export const workerProcessEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    ...redisEnvironmentSchema.shape,
    ...storageEnvironmentShape,
    APIFY_TOKEN: z.string().min(1).optional(),
    WORKER_CHANNEL: z.enum(Channel).optional(),
    WORKER_ROLE: z.enum(['ingest', 'processor', 'all']).optional(),
    /** One key for both processor model roles (Jev decisions and extraction). */
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    /** Runs the processor in `WORKER_ROLE=all`; `processor` always runs it. */
    PROCESSOR_ENABLED: booleanFlag.default(false),
    PROCESSOR_DECISION_MODEL: z.string().min(1).default('typesafe/jev-1.14'),
    PROCESSOR_EXTRACTION_MODEL: z
      .string()
      .min(1)
      .default('anthropic/claude-opus-5.5'),
    PROCESSOR_CONCURRENCY: z.coerce.number().int().positive().default(4),
    PROCESSOR_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    PROCESSOR_CLAIM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900_000),
    PROCESSOR_DAILY_BUDGET_USD: z.coerce.number().positive().default(20),
  })
  .superRefine((env, ctx) => {
    requireStorage(env, ctx);
    if (env.WORKER_ROLE && env.WORKER_CHANNEL)
      ctx.addIssue({
        code: 'custom',
        path: ['WORKER_ROLE'],
        message: 'Set either WORKER_ROLE or WORKER_CHANNEL, not both',
      });
    if ((env.WORKER_CHANNEL || env.WORKER_ROLE === 'all') && !env.APIFY_TOKEN)
      ctx.addIssue({
        code: 'custom',
        path: ['APIFY_TOKEN'],
        message: 'Set APIFY_TOKEN to run channel collection workers',
      });
    if (
      (env.WORKER_ROLE === 'processor' ||
        (env.WORKER_ROLE === 'all' && env.PROCESSOR_ENABLED)) &&
      !env.OPENROUTER_API_KEY
    )
      ctx.addIssue({
        code: 'custom',
        path: ['OPENROUTER_API_KEY'],
        message: 'Set OPENROUTER_API_KEY to run the processor worker',
      });
  });

export const environmentSchema = databaseEnvironmentSchema
  .extend({
    ...redisEnvironmentSchema.shape,
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
    ...storageEnvironmentShape,
    /** Private bucket that holds resume PDFs. */
    STORAGE_RESUMES_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{1,62}$/)
      .default('resumes'),
    /** Apify API token for the collectors. Optional so the API boots without collection. */
    APIFY_TOKEN: z.string().min(1).optional(),
    /** Set by Nx in development to receive the server's ready signal. */
    NX_READY_SIGNAL_SOCKET: z.string().min(1).optional(),
  })
  .superRefine(requireStorage);

export type DatabaseEnvironmentVariables = z.infer<
  typeof databaseEnvironmentSchema
>;
export type SeedEnvironmentVariables = z.infer<typeof seedEnvironmentSchema>;
export type EnvironmentVariables = z.infer<typeof environmentSchema>;
export type RedisEnvironmentVariables = z.infer<typeof redisEnvironmentSchema>;
export type WorkerProcessEnvironmentVariables = z.infer<
  typeof workerProcessEnvironmentSchema
>;

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

/** Worker bootstrap validates only its infrastructure dependencies. */
export function validateWorkerEnvironment(
  config: Record<string, unknown>,
): RedisEnvironmentVariables {
  return parseEnvironment(redisEnvironmentSchema, config);
}

/** `validate` hook for the worker process. */
export function validateWorkerProcessEnvironment(
  config: Record<string, unknown>,
): WorkerProcessEnvironmentVariables {
  return parseEnvironment(workerProcessEnvironmentSchema, config);
}
