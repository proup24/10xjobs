import { ConfigService } from '@nestjs/config';
// Prisma's config loader also imports this module and does not resolve TS aliases.
import { EnvironmentType } from '../common/enums';
import { loadEnvironmentFiles } from './environment.loader';
import {
  databaseEnvironmentSchema,
  parseEnvironment,
} from './environment.validation';

import type {
  DatabaseEnvironmentVariables,
  EnvironmentVariables,
  RedisEnvironmentVariables,
} from './environment.validation';

export { loadEnvironmentFiles } from './environment.loader';
export {
  databaseEnvironmentSchema,
  environmentSchema,
  parseEnvironment,
  validateEnvironment,
  redisEnvironmentSchema,
  validateWorkerEnvironment,
} from './environment.validation';
export type {
  DatabaseEnvironmentVariables,
  EnvironmentVariables,
  RedisEnvironmentVariables,
} from './environment.validation';

type AppConfigService = ConfigService<EnvironmentVariables, true>;

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: EnvironmentType;
  sentryDsn?: string;
}

export interface CookieConfig {
  domain?: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

export interface DatabaseConfig {
  url: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  slowQueryMs: number;
  logQueries: boolean;
}

export interface RedisConfig {
  url: string;
  cacheUrl: string;
  prefix: string;
  commandTimeoutMs: number;
  cacheTtlSeconds: number;
  jobsConcurrency: number;
}

export function getRedisConfig(
  config: ConfigService<RedisEnvironmentVariables, true>,
): RedisConfig {
  return {
    url: config.get('REDIS_URL', { infer: true }),
    cacheUrl: config.get('REDIS_CACHE_URL', { infer: true }),
    prefix: config.get('REDIS_PREFIX', { infer: true }),
    commandTimeoutMs: config.get('REDIS_COMMAND_TIMEOUT_MS', { infer: true }),
    cacheTtlSeconds: config.get('CACHE_TTL_SECONDS', { infer: true }),
    jobsConcurrency: config.get('JOBS_CONCURRENCY', { infer: true }),
  };
}

export function getAppConfig(config: AppConfigService): AppConfig {
  return {
    host: config.get('HOST', { infer: true }),
    port: config.get('PORT', { infer: true }),
    nodeEnv: config.get('NODE_ENV', { infer: true }),
    sentryDsn: config.get('SENTRY_DSN', { infer: true }),
  };
}

export function getSystemDomain(config: AppConfigService): string {
  return config.get('SYSTEM_DOMAIN', { infer: true });
}

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export function getBasicAuthConfig(config: AppConfigService): BasicAuthConfig {
  return {
    username: config.get('BASIC_AUTH_USERNAME', { infer: true }),
    password: config.get('BASIC_AUTH_PASSWORD', { infer: true }),
  };
}

export interface StorageConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  resumesBucket: string;
}

/** Validation guarantees one of each URL and key pair is set. */
export function getStorageConfig(config: AppConfigService): StorageConfig {
  return {
    supabaseUrl: (config.get('SUPABASE_URL', { infer: true }) ??
      config.get('SUPABASE_PUBLIC_URL', { infer: true })) as string,
    serviceRoleKey: (config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) ??
      config.get('SERVICE_ROLE_KEY', { infer: true })) as string,
    resumesBucket: config.get('STORAGE_RESUMES_BUCKET', { infer: true }),
  };
}

export function getCookieConfig(config: AppConfigService): CookieConfig {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  return {
    domain: config.get('COOKIE_DOMAIN', { infer: true }),
    // Secure cookies by default everywhere except local development.
    secure:
      config.get('COOKIE_SECURE', { infer: true }) ??
      nodeEnv !== EnvironmentType.development,
    sameSite: config.get('COOKIE_SAME_SITE', { infer: true }),
  };
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

export function getDatabaseConfig(config: AppConfigService): DatabaseConfig {
  return toDatabaseConfig({
    DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
    DIRECT_DATABASE_URL: config.get('DIRECT_DATABASE_URL', { infer: true }),
    DATABASE_CONNECTION_TIMEOUT_MS: config.get(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      { infer: true },
    ),
    DATABASE_IDLE_TIMEOUT_MS: config.get('DATABASE_IDLE_TIMEOUT_MS', {
      infer: true,
    }),
    DATABASE_SLOW_QUERY_MS: config.get('DATABASE_SLOW_QUERY_MS', {
      infer: true,
    }),
    DATABASE_LOG_QUERIES: config.get('DATABASE_LOG_QUERIES', { infer: true }),
  });
}

/**
 * @description For code running outside Nest (seeds, scripts): loads the env
 * files and validates only the database variables.
 */
export function loadDatabaseEnvironment(): DatabaseEnvironmentVariables {
  loadEnvironmentFiles();
  return parseEnvironment(databaseEnvironmentSchema, process.env);
}
