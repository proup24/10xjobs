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
} from './environment.validation';

export { loadEnvironmentFiles } from './environment.loader';
export {
  databaseEnvironmentSchema,
  environmentSchema,
  parseEnvironment,
  validateEnvironment,
} from './environment.validation';
export type {
  DatabaseEnvironmentVariables,
  EnvironmentVariables,
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

export function getResumeStorageDir(config: AppConfigService): string {
  return config.get('RESUME_STORAGE_DIR', { infer: true });
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
