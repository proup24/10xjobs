import { MemoryProcessorRepository } from './fakes';
import type { TypedColumns } from '../rules/typed-columns';

describe('MemoryProcessorRepository finish', () => {
  it('gives the attempt back on a refunded pending finish', async () => {
    const repo = new MemoryProcessorRepository();
    repo.addJob({ id: 'j1', processingAttempts: 1 });
    const claim = (await repo.claim('j1'))!;
    expect(claim.attempts).toBe(2);
    expect(
      await repo.finish(claim, {
        status: 'pending',
        error: '401',
        refundAttempt: true,
      }),
    ).toBe('finished');
    expect(repo.jobs.get('j1')).toMatchObject({
      processingStatus: 'pending',
      processingAttempts: 1,
      processingError: '401',
    });
  });

  it('keeps the attempt on an ordinary retry', async () => {
    const repo = new MemoryProcessorRepository();
    repo.addJob({ id: 'j1' });
    const claim = (await repo.claim('j1'))!;
    await repo.finish(claim, { status: 'pending', error: '429' });
    expect(repo.jobs.get('j1')?.processingAttempts).toBe(1);
  });
});

describe('MemoryProcessorRepository posts', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  it('scopes posts to 7 days and unsilenced authors, newest first', async () => {
    const repo = new MemoryProcessorRepository(() => now);
    repo.addJob({ id: 'old', kind: 'post', firstSeenAt: ago(8 * 24) });
    repo.addJob({
      id: 'held',
      kind: 'post',
      firstSeenAt: ago(1),
      silenced: true,
    });
    repo.addJob({ id: 'p2', kind: 'post', firstSeenAt: ago(2) });
    repo.addJob({ id: 'p1', kind: 'post', firstSeenAt: ago(1) });
    repo.addJob({ id: 'l1' });

    expect(await repo.listPendingPosts(10)).toEqual(['p1', 'p2']);
    expect(await repo.listPendingInScope(10)).toEqual(['l1']);
    expect(await repo.claim('old')).toBeNull();
    expect(await repo.claim('held')).toBeNull();
    expect((await repo.processingCounts()).posts).toMatchObject({
      pending: 2,
      outOfWindow: 1,
      silenced: 1,
    });
    repo.jobs.get('held')!.silenced = false;
    expect(await repo.claim('held')).not.toBeNull();
  });

  it('reuses by doc type', async () => {
    const repo = new MemoryProcessorRepository(() => now);
    repo.addJob({ id: 'p1', kind: 'post' });
    const key = {
      docType: 'post' as const,
      inputHash: 'h',
      schemaVersion: 1,
      promptHash: 'p',
      extractionModel: 'm',
    };
    const id = await repo.saveExtraction({
      ...key,
      ...({} as TypedColumns),
      jobId: 'p1',
      data: {} as never,
      needsReview: false,
      costUsd: 0,
      verdict: 'hiring',
      verdictReason: 'hiring',
      verdictConfidence: 'sure',
    });
    expect(await repo.findReusable(key)).toEqual({ id, jobId: 'p1' });
    expect(await repo.findReusable({ ...key, docType: 'listing' })).toBeNull();
  });

  it('upserts role jobs by key, archives the ones not kept, and never claims them', async () => {
    const repo = new MemoryProcessorRepository(() => now);
    repo.addJob({ id: 'p1', kind: 'post', processingStatus: 'processed' });
    const role = (roleKey: string, extractionId = 'e1') =>
      repo.upsertRoleJob({
        postJobId: 'p1',
        roleKey,
        title: `Role ${roleKey}`,
        companyName: null,
        extractionId,
      });
    const a = await role('a');
    const b = await role('b');
    expect(await role('a', 'e2')).toBe(a);
    expect(repo.jobs.get(a)).toMatchObject({
      kind: 'post_role',
      parentJobId: 'p1',
      processingStatus: 'processed',
      currentExtractionId: 'e2',
    });
    expect(await repo.archiveRoleJobs('p1', ['a'])).toBe(1);
    expect(repo.jobs.get(b)?.processingStatus).toBe('archived');
    expect(repo.jobs.get(a)?.processingStatus).toBe('processed');

    repo.jobs.get(a)!.processingStatus = 'pending';
    expect(await repo.claim(a)).toBeNull();
    expect((await repo.processingCounts()).posts.pending).toBe(0);
  });

  it('counts non-eval post calls since a date', async () => {
    const repo = new MemoryProcessorRepository(() => now);
    await repo.recordAttempts([
      { ...attempt(), docType: 'post' },
      { ...attempt(), docType: 'post', eval: true },
      { ...attempt(), docType: 'listing' },
    ]);
    expect(await repo.postCallsSince(ago(1))).toBe(1);
  });
});

function attempt() {
  return {
    jobId: null,
    extractionId: null,
    eval: false,
    step: 'generation' as const,
    outcome: 'ok' as const,
    error: null,
    quoteFailures: 0,
    docType: 'listing' as const,
    model: 'm',
    providerRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  };
}
