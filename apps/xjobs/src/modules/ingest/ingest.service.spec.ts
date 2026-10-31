import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { IngestService } from './ingest.service';
import { IngestRepository } from './ingest.repository';
import {
  IngestIdentityConflict,
  type NormalizedJob,
  type SaveOutcome,
} from './types';

const queryId = '12345678-abcd-4000-8000-123456789abc';
const batch = {
  queryId,
  observedAt: new Date('2026-10-30T12:00:00Z'),
  items: [
    {
      externalId: '123',
      url: 'https://www.linkedin.com/jobs/view/123',
      description: 'Build APIs',
      raw: {},
    },
  ],
};
class Repository extends IngestRepository {
  saved: NormalizedJob[] = [];
  exists = true;
  error: Error | null = null;
  async findQuery() {
    return this.exists
      ? { id: queryId, channel: Channel.LINKEDIN_JOB_BOARD }
      : null;
  }
  async save(_queryId: string, item: NormalizedJob): Promise<SaveOutcome> {
    if (this.error) throw this.error;
    this.saved.push(item);
    return {
      id: 'job-1',
      outcome: this.saved.length === 1 ? 'inserted' : 'duplicate',
    };
  }
}

describe('IngestService', () => {
  let repository: Repository;
  let service: IngestService;
  beforeEach(() => {
    repository = new Repository();
    service = new IngestService(repository);
  });

  it('persists valid siblings, reports invalid input and returns accepted job IDs', async () => {
    const report = await service.ingest({
      ...batch,
      items: [batch.items[0], { description: '' }, batch.items[0]],
    });
    expect(report).toMatchObject({
      inserted: 1,
      updated: 0,
      duplicate: 1,
      invalid: 1,
      jobIds: ['job-1'],
    });
    expect(report.errors).toEqual([
      { index: 1, reason: 'Malformed collector item' },
    ]);
    expect(repository.saved).toHaveLength(2);
  });

  it('rejects missing queries before storing items', async () => {
    repository.exists = false;
    await expect(service.ingest(batch)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.saved).toHaveLength(0);
  });

  it('rejects mismatched channel, invalid timestamp, query ID and oversized batch', async () => {
    for (const input of [
      { ...batch, channel: Channel.ASHBY },
      { ...batch, observedAt: new Date(NaN) },
      { ...batch, queryId: 'invalid' },
      { ...batch, items: Array(1001).fill(batch.items[0]) },
    ])
      await expect(service.ingest(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    expect(repository.saved).toHaveLength(0);
  });

  it('reports identity conflicts as item errors', async () => {
    repository.error = new IngestIdentityConflict(
      'Source ID and URL belong to different jobs',
    );
    expect(await service.ingest(batch)).toMatchObject({
      invalid: 1,
      inserted: 0,
      errors: [{ index: 0, reason: repository.error.message }],
    });
  });

  it('propagates infrastructure errors for batch retry', async () => {
    repository.error = new Error('Database unavailable');
    await expect(service.ingest(batch)).rejects.toThrow('Database unavailable');
  });
});
