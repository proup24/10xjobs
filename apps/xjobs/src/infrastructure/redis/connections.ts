import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import type { RedisConfig } from 'src/config';
import { REDIS_SETTINGS } from './settings.module';

/** Each role owns a connection; a subscribed connection cannot serve commands. */
@Injectable()
export class RedisConnections implements OnApplicationShutdown {
  readonly cache: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;
  private readonly logger = new Logger(RedisConnections.name);

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    const create = (url: string, role: string) => {
      const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        connectTimeout: settings.commandTimeoutMs,
        commandTimeout: settings.commandTimeoutMs,
        retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
      });
      client.on('error', () =>
        this.logger.warn(`Redis ${role} connection unavailable`),
      );
      return client;
    };
    this.cache = create(settings.cacheUrl, 'cache');
    this.publisher = create(settings.url, 'publisher');
    this.subscriber = create(settings.url, 'subscriber');
  }

  onApplicationShutdown(): void {
    // Cache and pub/sub do not hold jobs; disconnect also stops reconnect timers.
    for (const client of [this.cache, this.publisher, this.subscriber])
      client.disconnect();
  }
}
