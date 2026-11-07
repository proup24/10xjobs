import { z } from 'zod';
import {
  booleanFlag,
  databaseEnvironmentSchema,
  parseEnvironment,
} from '@xjobs/database/env';
import { Channel, EnvironmentType } from '../common/enums';

export {
  databaseEnvironmentSchema,
  parseEnvironment,
  seedEnvironmentSchema,
} from '@xjobs/database/env';
export type {
  DatabaseEnvironmentVariables,
  SeedEnvironmentVariables,
} from '@xjobs/database/env';

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
 * The processor's settings, read by the worker processes and by the API (its
 * testing endpoints). The key is optional here: without it, `worker-all`
 * skips the processor and the endpoints that call models refuse.
 */
const processorEnvironmentShape = {
  /** One key for both processor model roles (Jev decisions and extraction). */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  PROCESSOR_DECISION_MODEL: z.string().min(1).default('typesafe/jev-1.14'),
  PROCESSOR_EXTRACTION_MODEL: z
    .string()
    .min(1)
    .default('deepseek/deepseek-v4.1-flash-1017'),
  PROCESSOR_CONCURRENCY: z.coerce.number().int().positive().default(4),
  PROCESSOR_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PROCESSOR_CLAIM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  PROCESSOR_DAILY_BUDGET_USD: z.coerce.number().positive().default(20),
  /** Regenerations after the first generation when Jev rejects a field; capped, since each one is a paid generation. */
  PROCESSOR_MAX_REGENERATIONS: z.coerce.number().int().min(0).max(5).default(2),
  /** Schema tries per generation; capped like the regenerations. */
  PROCESSOR_GENERATION_TRIES: z.coerce.number().int().min(1).max(5).default(3),
};

export const processorEnvironmentSchema = z.object(processorEnvironmentShape);

/**
 * A worker process. `WORKER_ROLE=ingest` runs the ingest worker,
 * `WORKER_ROLE=processor` runs the processor (needs `OPENROUTER_API_KEY`), and
 * `WORKER_ROLE=all` runs the infrastructure, ingest and every channel's
 * collection worker in one process, plus the processor whenever
 * `OPENROUTER_API_KEY` is set. Otherwise `WORKER_CHANNEL` unset runs the
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
    ...processorEnvironmentShape,
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
    if (env.WORKER_ROLE === 'processor' && !env.OPENROUTER_API_KEY)
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
    ...processorEnvironmentShape,
    /** Set by Nx in development to receive the server's ready signal. */
    NX_READY_SIGNAL_SOCKET: z.string().min(1).optional(),
  })
  .superRefine(requireStorage);

export type ProcessorEnvironmentVariables = z.infer<
  typeof processorEnvironmentSchema
>;
export type EnvironmentVariables = z.infer<typeof environmentSchema>;
export type RedisEnvironmentVariables = z.infer<typeof redisEnvironmentSchema>;
export type WorkerProcessEnvironmentVariables = z.infer<
  typeof workerProcessEnvironmentSchema
>;

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
