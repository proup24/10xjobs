import { Test } from '@nestjs/testing';
import { DatabaseService } from 'src/database';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { IngestModule } from './ingest.module';
import { BatchIngestService } from './services/batch-ingest.service';

async function compile(first = vi.fn().mockResolvedValue(null)) {
  return Test.createTestingModule({ imports: [IngestModule] })
    .overrideProvider(DatabaseService)
    .useValue({
      db: {
        orm: {
          public: {
            CollectionBatch: { where: () => ({ first }) },
          },
        },
      },
    })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
}

it('exports a wired batch ingest service that skips unknown batches', async () => {
  const first = vi.fn().mockResolvedValue(null);
  const module = await compile(first);
  try {
    expect(
      await module.get(BatchIngestService).ingestBatch('missing', { final: false }),
    ).toBeNull();
    expect(first).toHaveBeenCalledOnce();
  } finally {
    await module.close();
  }
});
