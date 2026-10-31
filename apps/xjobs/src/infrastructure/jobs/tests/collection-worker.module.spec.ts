import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.APIFY_TOKEN ??= 'apify-token';
  process.env.WORKER_CHANNEL ??= 'ASHBY';
});
import { Channel } from 'src/common/enums';
import { COLLECTION_JOBS } from '../collection';
import { CollectionWorkerModule } from '../collection/collection-worker.module';

it('provides one collection job per channel, wired to its own collector', async () => {
  // Compiling builds the providers without lifecycle hooks: nothing connects.
  const module = await Test.createTestingModule({
    imports: [CollectionWorkerModule],
  }).compile();
  try {
    for (const channel of Object.values(Channel)) {
      expect(module.get(COLLECTION_JOBS[channel]).channel).toBe(channel);
    }
  } finally {
    await module.close();
  }
});
