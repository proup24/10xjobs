import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, getDatabaseConfig } from 'src/config';
import { DatabaseClient, createDatabaseClient } from './connection.source';

/**
 * @description Owns the single Prisma 8 client for the application. Inject it
 * and use `db.orm`, `db.sql` or `db.transaction(...)`:
 *
 * ```ts
 * constructor(private readonly database: DatabaseService) {}
 * findUser(email: string) {
 *   return this.database.db.orm.public.User.where({ email }).first();
 * }
 * ```
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly db: DatabaseClient;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.db = createDatabaseClient(getDatabaseConfig(config), this.logger);
  }

  /** Fails startup fast when the database is unreachable. */
  async onModuleInit(): Promise<void> {
    await this.ping();
    this.logger.log('Database connection established');
  }

  /** Runs on SIGTERM/SIGINT when `app.enableShutdownHooks()` is enabled. */
  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
    this.logger.log('Database connection closed');
  }

  /** Round-trips a trivial statement; use it for health checks. */
  async ping(): Promise<void> {
    await this.db.execute(this.db.raw.sql`SELECT 1`.affectedCount().build());
  }
}
