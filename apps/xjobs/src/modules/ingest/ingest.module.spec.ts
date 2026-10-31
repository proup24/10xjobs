import { Test } from '@nestjs/testing';
import { DatabaseService } from 'src/database';
import { IngestModule } from './ingest.module';
import { IngestService } from './ingest.service';

it('exports a wired ingest service from its Nest module', async () => {
  const first = vi.fn().mockResolvedValue(null);
  const module = await Test.createTestingModule({ imports: [IngestModule] })
    .overrideProvider(DatabaseService)
    .useValue({
      db: {
        orm: { public: { QuerySearchBuilder: { where: () => ({ first }) } } },
      },
    })
    .compile();
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
