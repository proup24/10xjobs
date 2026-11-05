import { ServiceUnavailableException } from '@nestjs/common';
import { HealthStatus } from '../dto/health.response.dto';
import { HealthController } from './health.controller';

const up = { status: 'up', latencyMs: 1 } as const;
const down = { status: 'down', latencyMs: 1 } as const;

function controller(result: unknown) {
  return new HealthController({ check: async () => result } as never);
}

describe('HealthController', () => {
  it('returns the checks when healthy or degraded', async () => {
    const degraded = {
      status: HealthStatus.degraded,
      checks: { database: up, queue: up, cache: down },
    };
    await expect(controller(degraded).check()).resolves.toEqual(degraded);
  });

  it('throws 503 naming the dependencies that are down', async () => {
    const failing = controller({
      status: HealthStatus.error,
      checks: { database: down, queue: up, cache: down },
    }).check();
    await expect(failing).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failing).rejects.toThrow('Unhealthy: database, cache down');
  });
});
