import { Logger } from '@nestjs/common';
import supabaseRuntimeDescriptor from '@prisma/orm-extension-supabase/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { DatabaseConfig } from 'src/config';
import type { Contract } from './contract.d';
import contractJson from './contract.json';
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
  logger = new Logger('Database'),
) {
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
