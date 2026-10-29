import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisConfig } from '../../config';
import { REDIS_SETTINGS } from './redis-settings.module';
import { RedisConnections } from './redis-connections';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(RedisConnections) private readonly connections: RedisConnections,
    @Inject(REDIS_SETTINGS) private readonly settings: RedisConfig,
  ) {}

  private key(key: string): string {
    if (!key) throw new Error('Cache key must not be empty');
    return `${this.settings.prefix}:cache:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const namespaced = this.key(key);
    try {
      const value = await this.connections.cache.get(namespaced);
      return value === null ? null : JSON.parse(value) as T;
    } catch {
      this.logger.warn('Cache read failed; treating as a miss');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = this.settings.cacheTtlSeconds): Promise<void> {
    const namespaced = this.key(key);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('Cache TTL must be a positive integer');
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Cache value must be JSON serializable');
    try {
      await this.connections.cache.set(namespaced, serialized, 'EX', ttlSeconds);
    } catch {
      this.logger.warn('Cache write failed');
    }
  }

  async delete(key: string): Promise<void> {
    // Invalidation failure is surfaced so callers do not assume stale data was removed.
    await this.connections.cache.del(this.key(key));
  }

  async remember<T>(key: string, load: () => Promise<T>, ttlSeconds = this.settings.cacheTtlSeconds): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await load();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
