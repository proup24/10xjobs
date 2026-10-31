import { Test } from '@nestjs/testing';
import { DatabaseService } from 'src/database';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { IngestModule } from './ingest.module';
import { BatchIngestService } from './services/batch-ingest.service';
import { IngestService } from './services/ingest.service';

async function compile(first = vi.fn().mockResolvedValue(null)) {
  return Test.createTestingModule({ imports: [IngestModule] })
    .overrideProvider(DatabaseService)
    .useValue({
      db: {
        orm: {
          public: {
            QuerySearchBuilder: { where: () => ({ first }) },
            CollectionBatch: { where: () => ({ first }) },
          },
        },
      },
    })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
}

it('exports a wired ingest service from its Nest module', async () => {
  const first = vi.fn().mockResolvedValue(null);
  const module = await compile(first);
  try {
    await expect(
      module.get(IngestService).ingest({
        queryId: '12345678-abcd-4000-8000-123456789abc',
        observedAt: new Date(),
        items: [],
      }),
    ).rejects.toThrow('Lookup query not found');
    expect(first).toHaveBeenCalledOnce();
  } finally {
    await module.close();
  }
});

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
