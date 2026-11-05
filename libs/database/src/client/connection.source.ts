import supabaseRuntimeDescriptor from '@prisma/orm-extension-supabase/runtime';
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { DatabaseConfig } from '../env';
// Generated types are never emitted to dist; this entry resolves to the source.
import type { Contract } from '@xjobs/database/contract';
import contractJson from '../contract/contract.json';
import { consoleLogger, type DatabaseLogger } from './database-logger';
import { queryLogger } from './logger.middleware';

export const contract = contractFromJson<Contract>(contractJson);

/**
 * @description Builds the Prisma 8 client. The client connects lazily: the
 * pool opens its first connection on the first query, so this never blocks.
 * A server keeps one client for the process lifetime; scripts must call
 * `close()` when done or Node will not exit.
 */
export function createDatabaseClient(
  config: DatabaseConfig,
  logger: DatabaseLogger = consoleLogger(),
): PostgresClient<Contract> {
  return postgres({
    contract,
    url: config.url,
    extensions: [supabaseRuntimeDescriptor],
    poolOptions: {
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs,
    },
    middleware: [queryLogger(config, logger)],
    log: {
      info: (event) => logger.log(event),
      warn: (event) => logger.warn(event),
      error: (event) => logger.error(event),
      debug: (event) => logger.debug(event),
    },
  });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
