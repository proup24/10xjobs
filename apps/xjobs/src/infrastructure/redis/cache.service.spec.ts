import { CacheService } from './cache.service';
import { ConfigService } from '@nestjs/config';
import { getRedisConfig, validateWorkerEnvironment } from '../../config';

function setup() {
  const values = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { values.set(key, value); return 'OK'; }),
    del: vi.fn(async (key: string) => Number(values.delete(key))),
  };
  const cache = new CacheService({ cache: client } as never, getRedisConfig(new ConfigService(validateWorkerEnvironment({}))));
  return { cache, client, values };
}

describe('cache', () => {
  it('round trips JSON, caches falsy values, and invalidates explicitly', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => false);
    expect(await cache.remember('ws:1:flag', load)).toBe(false);
    expect(await cache.remember('ws:1:flag', load)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.delete('ws:1:flag');
    expect(await cache.get('ws:1:flag')).toBeNull();
  });

  it('sets an expiring, namespaced key and rejects invalid TTLs', async () => {
    const { cache, client } = setup();
    await cache.set('ws:1:user', { id: 1 }, 20);
    expect(client.set).toHaveBeenCalledWith('xjobs:cache:ws:1:user', '{"id":1}', 'EX', 20);
    await expect(cache.set('key', 1, 0)).rejects.toThrow();
  });

  it('falls back to the loader during a Redis outage', async () => {
    const { cache, client } = setup();
    client.get.mockRejectedValue(new Error('offline'));
    client.set.mockRejectedValue(new Error('offline'));
    expect(await cache.remember('key', async () => ({ fresh: true }))).toEqual({ fresh: true });
  });

  it('treats corrupt JSON as a miss but propagates source failures', async () => {
    const { cache, values } = setup();
    values.set('xjobs:cache:key', 'invalid json');
    expect(await cache.get('key')).toBeNull();
    await expect(cache.remember('key', async () => { throw new Error('source unavailable'); }))
      .rejects.toThrow('source unavailable');
  });
});
