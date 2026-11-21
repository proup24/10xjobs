import { z } from 'zod';
import {
  booleanFlag,
  databaseEnvironmentSchema,
  parseEnvironment,
} from '@xjobs/database/env';
import { Channel, EnvironmentType, TRIAL_CHANNELS } from '../common/enums';
import {
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from '../modules/processor/models/claude/startup';

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

/** The web app's public origin, for links in webhook payloads; payloads carry no link without it. */
const webAppShape = { WEB_APP_URL: z.url().optional() };

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
 * Daily spend caps, in US dollars, on LinkedIn collection (Morocco day):
 * harvestapi's job board, the cheap_scraper and bebity trials' own, and posts'.
 * And the trial channels that collect (comma-separated channel values; none by
 * default).
 */
const collectionBudgetShape = {
  COLLECTION_DAILY_BUDGET_USD: z.coerce.number().positive().finite().default(3),
  COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP: z.coerce
    .number()
    .positive()
    .finite()
    .default(3),
  COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY: z.coerce
    .number()
    .positive()
    .finite()
    .default(1),
  /** LinkedIn posts' own cap; each posts run may charge at most what is left of it. */
  COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS: z.coerce
    .number()
    .positive()
    .finite()
    .default(1.5),
  COLLECTION_TRIAL_CHANNELS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(TRIAL_CHANNELS as [Channel, ...Channel[]]))),
};

/**
 * Supabase user ids allowed to turn LinkedIn post search on, comma separated.
 * Empty (the default) allows nobody.
 */
const postSearchShape = {
  POST_SEARCH_USERS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
};

/**
 * Supabase user ids allowed to use the admin routes, comma separated. Empty
 * (the default) allows nobody.
 */
const adminShape = {
  ADMIN_USERS: postSearchShape.POST_SEARCH_USERS,
};

/** Just the post search allow-list, for scripts that load no other settings. */
export const postSearchEnvironmentSchema = z.object(postSearchShape);

/**
 * The processor's settings, read by the worker processes and by the API (its
 * testing endpoints). The credentials are optional here: without one,
 * `worker-all` skips the processor and the endpoints that call models refuse.
 * An empty value counts as unset.
 */
const processorEnvironmentShape = {
  /** The Claude subscription token from `claude setup-token`. */
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  /** An Anthropic API key; `claude -p` uses it instead of the token when set. */
  ANTHROPIC_API_KEY: z.string().optional(),
  PROCESSOR_EXTRACTION_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  /** `claude -p --effort` for the generator. */
  PROCESSOR_EFFORT: z.string().min(1).default('low'),
  /** One `claude -p` call is killed after this long. */
  PROCESSOR_CALL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180_000),
  PROCESSOR_CONCURRENCY: z.coerce.number().int().positive().default(4),
  PROCESSOR_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PROCESSOR_CLAIM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  PROCESSOR_WEEKLY_STOP_AT: z.coerce.number().gt(0).max(1).default(0.85),
  /** 0 means no cap: the subscription's limits stop processing first. */
  PROCESSOR_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  /** Schema tries per generation; capped, since each one is a model call. */
  PROCESSOR_GENERATION_TRIES: z.coerce.number().int().min(1).max(5).default(3),
};

export const processorEnvironmentSchema = z.object(processorEnvironmentShape);

/**
 * A worker process. `WORKER_ROLE=ingest` runs the ingest worker,
 * `WORKER_ROLE=processor` runs the processor (needs `CLAUDE_CODE_OAUTH_TOKEN`
 * or `ANTHROPIC_API_KEY`),
 * `WORKER_ROLE=match` runs the matcher,
 * `WORKER_ROLE=webhook` sends the webhook deliveries, and
 * `WORKER_ROLE=all` runs the infrastructure, ingest and every channel's
 * collection worker, the matcher and the webhook sender in one process, plus the processor whenever
 * one of those credentials is set. Otherwise `WORKER_CHANNEL` unset runs the
 * infrastructure worker, and a channel runs that channel's collection job.
 * Collection needs an Apify token. An unknown role or
 * channel fails startup rather than falling back. Every worker needs Supabase
 * Storage, where collection batches are written and read.
 */
export const workerProcessEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    ...redisEnvironmentSchema.shape,
    ...storageEnvironmentShape,
    ...webAppShape,
    /** In development, each collection worker runs one collection at startup. */
    NODE_ENV: z.enum(EnvironmentType).default(EnvironmentType.development),
    APIFY_TOKEN: z.string().min(1).optional(),
    ...collectionBudgetShape,
    WORKER_CHANNEL: z.enum(Channel).optional(),
    WORKER_ROLE: z
      .enum(['ingest', 'processor', 'match', 'webhook', 'all'])
      .optional(),
    /**
     * Registers the workers' cron and sweep schedulers. Set only on the hosted
     * engine; local workers remove theirs.
     */
    XJOBS_RUN_SCHEDULES: booleanFlag.default(false),
    ...processorEnvironmentShape,
    ...postSearchShape,
    ...adminShape,
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
    if (env.WORKER_ROLE === 'processor' && !hasClaudeCredential(env))
      ctx.addIssue({
        code: 'custom',
        path: ['CLAUDE_CODE_OAUTH_TOKEN'],
        message: `processor not started: ${NO_CLAUDE_CREDENTIAL}`,
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
    /** Shared secret the web app sends as `X-Engine-Key` on every request. */
    ENGINE_API_KEY: z
      .string()
      .min(32, 'ENGINE_API_KEY must be at least 32 characters'),
    ...storageEnvironmentShape,
    ...webAppShape,
    /** Apify API token for the collectors. Optional so the API boots without collection. */
    APIFY_TOKEN: z.string().min(1).optional(),
    ...collectionBudgetShape,
    ...processorEnvironmentShape,
    ...postSearchShape,
    ...adminShape,
    /** Mounts the operator routes (processor, matcher, query search); local only. */
    XJOBS_OPERATOR_ENDPOINTS: booleanFlag.default(false),
    /** Set by Nx in development to receive the server's ready signal. */
    NX_READY_SIGNAL_SOCKET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    requireStorage(env, ctx);
    if (
      env.XJOBS_OPERATOR_ENDPOINTS &&
      env.NODE_ENV === EnvironmentType.production
    )
      ctx.addIssue({
        code: 'custom',
        path: ['XJOBS_OPERATOR_ENDPOINTS'],
        message:
          'XJOBS_OPERATOR_ENDPOINTS is local only; unset it when NODE_ENV=production',
      });
  });

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
