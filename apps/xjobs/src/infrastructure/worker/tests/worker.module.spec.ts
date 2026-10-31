import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.APIFY_TOKEN ??= 'apify-token';
  process.env.WORKER_CHANNEL ??= 'ASHBY';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
});

import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

it('wires the jobs module into the worker without connecting', async () => {
  // Compiling builds the providers without lifecycle hooks: nothing connects.
  const module = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  try {
    expect(module.get(WorkerService).active).toBe(true);
  } finally {
    await module.close();
  }
});
