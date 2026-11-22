import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostDetail } from '../../../ingest/normalize/record';
import type { ProcessorConfig } from '../../config/processor.config';
import {
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from '../../models/errors';
import type { PostModelOutput } from '../../schema/post-extraction';
import { FactAssembler } from '../../services/fact-assembler.service';
import { GenerationService } from '../../services/generation.service';
import { PostAssembler } from '../../services/post-assembler.service';
import { PostPipeline } from '../../services/post-pipeline.service';
import { ProcessorGuard } from '../../services/processor-guard.service';
import {
  FakeExtractionModel,
  MemoryProcessorRepository,
  MemoryVocabRepository,
} from '../../testing/fakes';
import type { PostGoldenCase } from './golden-posts';
import { postRunPasses, runPostEval } from './run-posts';

const EXT = 'anthropic/claude-opus-5.5';
const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 0,
  weeklyStopAt: 0.85,
  generationTries: 2,
  postDailyCap: 250,
};

const source = (id: string, text: string): PostDetail =>
  ({
    id,
    url: `https://www.linkedin.com/posts/${id}`,
    author: null,
    text,
    truncated: false,
    attachedUrls: [],
    postedAt: null,
    original: null,
    links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
  }) as unknown as PostDetail;

const goldenCase = (id: string): PostGoldenCase => ({
  rawItemId: `raw-${id}`,
  sources: [source(id, `Some thoughts on careers, post ${id}.`)],
  verdict: {
    value: 'not_hiring',
    reason: 'advice_or_commentary',
    reviewed: true,
  },
  roles: [],
  note: null,
});

const notHiring: PostModelOutput = {
  verdict: {
    value: 'not_hiring',
    reason: 'advice_or_commentary',
    quote: 'Some thoughts on careers',
    confidence: 'sure',
  },
  roles: [],
};

describe('runPostEval', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'debug', 'error'] as const)
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  async function run(
    respond: ConstructorParameters<typeof FakeExtractionModel>[0],
    cases = ['1', '2', '3'].map(goldenCase),
  ) {
    const model = new FakeExtractionModel(respond, EXT);
    const repo = new MemoryProcessorRepository();
    const guard = new ProcessorGuard(repo, config);
    const result = await runPostEval({
      cases,
      pipeline: new PostPipeline(
        new GenerationService(model, new FactAssembler(), config),
        new PostAssembler(new FactAssembler()),
      ),
      guard,
      vocabulary: await new MemoryVocabRepository().snapshot(),
      concurrency: 1,
    });
    return { result, model, repo };
  }

  it('scores every case in memory, with its calls and cost', async () => {
    const { result, repo } = await run(() => notHiring);

    expect(result.scores.map((s) => [s.index, s.got?.value])).toEqual([
      [0, 'not_hiring'],
      [1, 'not_hiring'],
      [2, 'not_hiring'],
    ]);
    expect(result.scores[0]).toMatchObject({
      generatorCalls: 1,
      costUsd: 0.01,
    });
    expect(result.notRun).toEqual([]);
    expect(result.limitStop).toBeNull();
    // Nothing written anywhere: no attempts, no extractions.
    expect(repo.attempts).toEqual([]);
    expect(repo.extractions).toEqual([]);
  });

  it('scores a generation that never validates as failed', async () => {
    const { result } = await run(() => ({
      ...notHiring,
      verdict: { ...notHiring.verdict, quote: 'not in the post' },
    }));

    expect(result.scores[0].failed).toEqual([
      'verdict.quote: not found in the post',
    ]);
    expect(result.scores[0].generatorCalls).toBe(2);
  });

  it('retries a transient failure', async () => {
    let n = 0;
    const { result } = await run(() => {
      if (n++ === 0) throw new TransientModelError('timeout');
      return notHiring;
    });

    expect(result.scores[0].got?.value).toBe('not_hiring');
    expect(result.scores).toHaveLength(3);
  });

  it('stops on a usage limit and lists the cases not run', async () => {
    let n = 0;
    const { result, model } = await run(() => {
      if (n++ === 1)
        throw new UsageLimitError('claude usage limit reached', null);
      return notHiring;
    });

    expect(result.scores.map((s) => s.index)).toEqual([0]);
    expect(result.notRun).toEqual([1, 2]);
    expect(result.limitStop?.reason).toBe('usage_limit');
    expect(model.calls).toHaveLength(2);
  });

  it('stops with the limit from the error itself', async () => {
    const resetsAt = new Date(Date.now() + 3_600_000);
    const { result } = await run(() => {
      throw new UsageLimitError('claude usage limit reached', {
        resetsAt,
      } as never);
    });

    expect(result.limitStop).toEqual({
      reason: 'usage_limit',
      until: resetsAt,
      detail: 'claude usage limit reached',
    });
    expect(result.notRun).toEqual([0, 1, 2]);
  });

  it('stops when the provider is unavailable', async () => {
    let n = 0;
    const { result, model } = await run(() => {
      if (n++ === 1) throw new ProviderUnavailableError('claude could not run');
      return notHiring;
    });

    expect(result.scores.map((s) => s.index)).toEqual([0]);
    expect(result.notRun).toEqual([1, 2]);
    expect(result.limitStop).toMatchObject({
      reason: 'auth',
      detail: 'claude could not run',
    });
    expect(model.calls).toHaveLength(2);
  });

  it('fails the run on a failed generation or a case not run', async () => {
    const passing = { pass: true };
    const ok = await run(() => notHiring);
    expect(postRunPasses(passing, ok.result)).toBe(true);
    expect(postRunPasses({ pass: false }, ok.result)).toBe(false);
    expect(postRunPasses(passing, { ...ok.result, notRun: [3] })).toBe(false);

    const failed = await run(() => ({
      ...notHiring,
      verdict: { ...notHiring.verdict, quote: 'not in the post' },
    }));
    expect(postRunPasses(passing, failed.result)).toBe(false);
  });
});
