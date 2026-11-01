import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from './health.service';

type Ping = () => Promise<unknown>;

function setup(pings: { database?: Ping; queue?: Ping; cache?: Ping } = {}) {
  const ok: Ping = async () => undefined;
  return new HealthService(
    { ping: pings.database ?? ok } as never,
    { ping: pings.queue ?? ok } as never,
    { ping: pings.cache ?? ok } as never,
  );
}

const fail: Ping = async () => {
  throw new Error('connection refused');
};

describe('HealthService', () => {
  it('is ok when every dependency answers', async () => {
    const result = await setup().check();
    expect(result.status).toBe('ok');
    for (const check of Object.values(result.checks)) {
      expect(check.status).toBe('up');
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(['database', 'queue'] as const)(
    'is an error when the critical %s is down',
    async (name) => {
      const result = await setup({ [name]: fail }).check();
      expect(result.status).toBe('error');
      expect(result.checks[name].status).toBe('down');
    },
  );

  it('is only degraded when the cache is down', async () => {
    const result = await setup({ cache: fail }).check();
    expect(result.status).toBe('degraded');
    expect(result.checks.cache.status).toBe('down');
    expect(result.checks.database.status).toBe('up');
  });

  it('counts a hanging probe as down after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const pending = setup({
        database: () => new Promise(() => undefined),
      }).check();
      await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
      const result = await pending;
      expect(result.status).toBe('error');
      expect(result.checks.database.status).toBe('down');
    } finally {
      vi.useRealTimers();
    }
  });
});
