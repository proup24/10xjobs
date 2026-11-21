import { Channel } from 'src/common/enums';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { ingestConfig } from '../config';
import {
  type BatchRecord,
  type LinkOutcome,
  RawStorageRepository,
  type SaveItemInput,
} from '../repositories/raw.repository';
import type { BatchFile, BatchReport, BatchStatus } from '../types';
import { serializeBatchFile } from '../utils';
import { BatchFileReaderService } from './batch-file-reader.service';
import { BatchItemWriterService } from './batch-item-writer.service';
import { BatchIngestService } from './batch.service';

const job = (id: string) => ({
  id,
  url: `https://www.linkedin.com/jobs/view/${id}`,
});

class FakeRepository extends RawStorageRepository {
  batches = new Map<string, BatchRecord>();
  saved: SaveItemInput[] = [];
  reports = new Map<string, BatchReport>();
  failed = new Map<string, string>();
  attemptFailures: { id: string; error: string; final: boolean }[] = [];
  keys = new Set<string>();
  failSave = false;
  /** The job outcome per source key; a created job by default. */
  outcomes = new Map<string, LinkOutcome>();

  async findBatch(id: string) {
    return this.batches.get(id) ?? null;
  }
  async saveItem(input: SaveItemInput) {
    if (this.failSave) throw new Error('connection reset');
    this.saved.push(input);
    const newItem = !this.keys.has(input.sourceKey);
    this.keys.add(input.sourceKey);
    const job = this.outcomes.get(input.sourceKey) ?? {
      jobId: `job-${input.sourceKey}`,
      created: newItem,
      reopened: false,
      pending: newItem,
    };
    return { newItem, newVersion: newItem, job };
  }
  async markIngested(id: string, report: BatchReport) {
    this.reports.set(id, report);
    this.setStatus(id, 'ingested');
  }
  async recordAttemptFailure(id: string, error: string, final: boolean) {
    this.attemptFailures.push({ id, error, final });
    if (final) this.setStatus(id, 'failed');
  }
  async markFailed(id: string, reason: string) {
    this.failed.set(id, reason);
    this.setStatus(id, 'failed');
  }
  async resetToPending(id: string) {
    const batch = this.batches.get(id);
    if (batch?.status !== 'failed') return false;
    this.batches.set(id, { ...batch, status: 'pending', attempts: 0 });
    return true;
  }
  async listStalePending() {
    return [];
  }
  private setStatus(id: string, status: BatchStatus) {
    const batch = this.batches.get(id)!;
    this.batches.set(id, { ...batch, status });
  }
}

const file = (over: Partial<BatchFile> = {}): BatchFile => ({
  formatVersion: 1,
  batchId: 'b1',
  channel: Channel.LINKEDIN_JOB_BOARD,
  segmentRunId: 'r1',
  observedAt: '2026-10-31T12:00:00.000Z',
  source: { actor: 'bebity/linkedin-jobs-scraper', apifyRunId: 'run-1' },
  queries: [
    { id: 'q1', keyword: 'node', params: {} },
    { id: 'q2', keyword: 'nest', params: {} },
  ],
  itemsByQuery: {
    q1: [{ rank: 1, payload: job('1') }],
    q2: [
      { rank: 2, payload: job('1') },
      { rank: null, payload: job('2') },
    ],
  },
  unattributed: [{ rank: null, payload: job('3') }],
  ...over,
});

describe('BatchIngestService', () => {
  let repo: FakeRepository;
  let storage: MemoryStorageService;
  let service: BatchIngestService;

  async function store(batch: BatchFile, status: BatchStatus = 'pending') {
    const key = `${batch.channel}/x/${batch.segmentRunId}.json`;
    repo.batches.set(batch.batchId, {
      id: batch.batchId,
      channel: batch.channel,
      storageKey: key,
      status,
      attempts: 0,
    });
    await storage.put(ingestConfig.bucket, key, serializeBatchFile(batch));
  }

  beforeEach(() => {
    repo = new FakeRepository();
    storage = new MemoryStorageService();
    service = new BatchIngestService(
      repo,
      new BatchFileReaderService(storage),
      new BatchItemWriterService(repo),
    );
  });

  it('saves every item with its query, rank and the batch observation time', async () => {
    await store(file());
    const report = await service.ingestBatch('b1', { final: false });

    expect(repo.saved.map((s) => [s.queryId, s.rank, s.sourceKey])).toEqual([
      ['q1', 1, 'id:1'],
      ['q2', 2, 'id:1'],
      ['q2', null, 'id:2'],
      [null, null, 'id:3'],
    ]);
    expect(repo.saved[0]).toMatchObject({
      batchId: 'b1',
      channel: Channel.LINKEDIN_JOB_BOARD,
      kind: 'job',
      observedAt: new Date('2026-10-31T12:00:00.000Z'),
      payload: job('1'),
    });
    expect(repo.saved[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report).toEqual({
      received: 4,
      newItems: 3,
      newVersions: 0,
      repeats: 1,
      invalid: 0,
      normalized: 4,
      normalizeInvalid: 0,
      newJobs: 3,
      reopened: 0,
      errors: [],
    });
    expect(repo.batches.get('b1')!.status).toBe('ingested');
    expect(repo.reports.get('b1')).toEqual(report);
  });

  it('removes null characters PostgreSQL cannot store, keeping the hash of the original', async () => {
    const post = {
      id: '7',
      content: 'Hiring\u0000 now',
      author: { name: 'A\u0000' },
    };
    await store(
      file({
        channel: Channel.LINKEDIN_POSTS,
        itemsByQuery: { q1: [{ rank: null, payload: post }] },
        unattributed: [],
      }),
    );
    await service.ingestBatch('b1', { final: false });

    expect(repo.saved[0]!.payload).toEqual({
      id: '7',
      content: 'Hiring now',
      author: { name: 'A' },
    });
    expect(JSON.stringify(repo.saved[0]!.payload)).not.toContain('\\u0000');
  });

  it('reports the post jobs and drops of a posts batch', async () => {
    repo.outcomes.set('id:p1', {
      jobId: 'job-p1',
      created: true,
      reopened: false,
      pending: false,
    });
    repo.outcomes.set('id:p2', { invalid: 'prepare: no-text' });
    await store(
      file({
        channel: Channel.LINKEDIN_POSTS,
        itemsByQuery: {
          q1: [
            { rank: 1, payload: { id: 'p1', content: 'Hiring' } },
            { rank: 2, payload: { id: 'p2', content: 'Hiring too' } },
          ],
        },
        unattributed: [],
      }),
    );
    await service.ingestBatch('b1', { final: false });

    expect(repo.reports.get('b1')).toMatchObject({
      received: 2,
      newItems: 2,
      normalized: 1,
      normalizeInvalid: 1,
      newJobs: 1,
    });
  });

  it('does nothing for a batch that is not pending', async () => {
    await store(file(), 'ingested');
    const get = vi.spyOn(storage, 'get');

    expect(await service.ingestBatch('b1', { final: false })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(repo.saved).toEqual([]);
  });

  it('does nothing for an unknown batch', async () => {
    expect(await service.ingestBatch('missing', { final: false })).toBeNull();
  });

  it('fails a batch whose file is missing', async () => {
    repo.batches.set('b1', {
      id: 'b1',
      channel: Channel.ASHBY,
      storageKey: 'ASHBY/x/r1.json',
      status: 'pending',
      attempts: 0,
    });
    await service.ingestBatch('b1', { final: false });
    expect(repo.failed.get('b1')).toBe('batch file missing');
  });

  it('fails a batch with an unknown format version', async () => {
    await store(file());
    const key = repo.batches.get('b1')!.storageKey;
    storage.objects
      .get(ingestConfig.bucket)!
      .set(key, Buffer.from(JSON.stringify({ ...file(), formatVersion: 2 })));

    await service.ingestBatch('b1', { final: false });
    expect(repo.failed.get('b1')).toMatch(/format version 2/);
    expect(repo.saved).toEqual([]);
  });

  it('fails a channel mismatch without saving items or consuming a retry', async () => {
    await store(file());
    const key = repo.batches.get('b1')!.storageKey;
    storage.objects
      .get(ingestConfig.bucket)!
      .set(key, serializeBatchFile(file({ channel: Channel.LINKEDIN_POSTS })));

    expect(await service.ingestBatch('b1', { final: false })).toBeNull();
    expect(repo.batches.get('b1')!.status).toBe('failed');
    expect(repo.failed.get('b1')).toBe('batch file channel mismatch');
    expect(repo.saved).toEqual([]);
    expect(repo.attemptFailures).toEqual([]);
    expect(repo.reports.size).toBe(0);
  });

  it('counts a new version separately from a new item and a repeat', async () => {
    await store(file());
    const save = repo.saveItem.bind(repo);
    vi.spyOn(repo, 'saveItem').mockImplementation(async (input) => {
      const result = await save(input);
      return input.queryId === 'q2' && input.sourceKey === 'id:1'
        ? { ...result, newItem: false, newVersion: true }
        : result;
    });

    expect(await service.ingestBatch('b1', { final: false })).toEqual({
      received: 4,
      newItems: 3,
      newVersions: 1,
      repeats: 0,
      invalid: 0,
      normalized: 4,
      normalizeInvalid: 0,
      newJobs: 3,
      reopened: 0,
      errors: [],
    });
  });

  it('ingests a batch whose items are all invalid, listing each reason', async () => {
    await store(
      file({
        itemsByQuery: { q1: [{ rank: 1, payload: { title: 'x' } }] },
        unattributed: [{ rank: null, payload: 'nope' }],
      }),
    );
    const report = await service.ingestBatch('b1', { final: false });

    expect(report).toMatchObject({ received: 2, invalid: 2, newItems: 0 });
    expect(report!.errors).toEqual([
      {
        stage: 'validate',
        queryId: 'q1',
        index: 0,
        reason: 'no source id or URL',
      },
      {
        stage: 'validate',
        queryId: null,
        index: 0,
        reason: 'payload is not a JSON object',
      },
    ]);
    expect(repo.batches.get('b1')!.status).toBe('ingested');
  });

  it('caps the listed errors but counts every invalid item', async () => {
    const bad = Array.from({ length: 150 }, () => ({
      rank: null,
      payload: {},
    }));
    await store(file({ itemsByQuery: { q1: bad }, unattributed: [] }));
    const report = await service.ingestBatch('b1', { final: false });

    expect(report!.invalid).toBe(150);
    expect(report!.errors).toHaveLength(ingestConfig.maxReportErrors);
  });

  it('records a failed attempt and rethrows on an infrastructure error', async () => {
    await store(file());
    repo.failSave = true;

    await expect(service.ingestBatch('b1', { final: false })).rejects.toThrow(
      'connection reset',
    );
    expect(repo.attemptFailures).toEqual([
      { id: 'b1', error: 'connection reset', final: false },
    ]);
    expect(repo.batches.get('b1')!.status).toBe('pending');
  });

  it('fails the batch on the last attempt', async () => {
    await store(file());
    repo.failSave = true;

    await expect(service.ingestBatch('b1', { final: true })).rejects.toThrow();
    expect(repo.batches.get('b1')!.status).toBe('failed');
  });

  it('records a storage outage as a failed attempt, not a bad file', async () => {
    await store(file());
    vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('503'));

    await expect(service.ingestBatch('b1', { final: false })).rejects.toThrow(
      '503',
    );
    expect(repo.failed.size).toBe(0);
    expect(repo.attemptFailures).toHaveLength(1);
  });

  it('replays only a failed batch', async () => {
    await store(file(), 'failed');
    expect(await service.replay('b1')).toBe(true);
    expect(repo.batches.get('b1')!.status).toBe('pending');

    await store(file({ batchId: 'b2', segmentRunId: 'r2' }), 'ingested');
    expect(await service.replay('b2')).toBe(false);
  });

  it('counts normalization outcomes and lists normalize errors by stage', async () => {
    await store(file());
    repo.outcomes.set('id:2', { invalid: 'normalize: title: required' });
    repo.outcomes.set('id:3', {
      jobId: 'j3',
      created: false,
      reopened: true,
      pending: true,
    });
    const report = await service.ingestBatch('b1', { final: false });

    expect(report).toMatchObject({
      received: 4,
      invalid: 0,
      normalized: 3,
      normalizeInvalid: 1,
      newJobs: 1,
      reopened: 1,
    });
    expect(report!.errors).toEqual([
      {
        stage: 'normalize',
        queryId: 'q2',
        index: 1,
        reason: 'normalize: title: required',
      },
    ]);
  });

  it('hands the pending jobs to onPending once, after the batch is ingested', async () => {
    await store(file());
    repo.outcomes.set('id:2', {
      jobId: 'j2',
      created: false,
      reopened: false,
      pending: false,
    });
    const calls: { channel: Channel; jobIds: string[]; status: string }[] = [];
    await service.ingestBatch('b1', {
      final: false,
      onPending: async (pending) => {
        calls.push({ ...pending, status: repo.batches.get('b1')!.status });
      },
    });

    expect(calls).toEqual([
      {
        channel: Channel.LINKEDIN_JOB_BOARD,
        jobIds: ['job-id:1', 'job-id:3'],
        status: 'ingested',
      },
    ]);
  });

  it('does not call onPending when no job is pending', async () => {
    await store(file({ itemsByQuery: {}, unattributed: [] }));
    const onPending = vi.fn(async () => undefined);
    await service.ingestBatch('b1', { final: false, onPending });
    expect(onPending).not.toHaveBeenCalled();
  });

  it('keeps an ingested batch ingested when onPending fails', async () => {
    await store(file());
    const report = await service.ingestBatch('b1', {
      final: false,
      onPending: async () => {
        throw new Error('redis down');
      },
    });

    expect(report).not.toBeNull();
    expect(repo.batches.get('b1')!.status).toBe('ingested');
    expect(repo.attemptFailures).toEqual([]);
  });
});
