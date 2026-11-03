import type { SeedEnvironmentVariables } from 'src/config';
import type { DatabaseClient } from '../connection.source';

/** The `tx` handed to a `db.transaction(...)` callback. */
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

/**
 * @description A seed runs inside its own transaction and must be idempotent:
 * running the seeds twice leaves the database in the same state.
 */
export interface Seed {
  name: string;
  run(tx: DatabaseTransaction, env: SeedEnvironmentVariables): Promise<void>;
}
