import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from '../models/errors';
import type { LimitObservation } from '../models/claude/stream';
import { EXTRACTION_SCHEMA_VERSION, extractionDocumentSchema } from '../schema';
import {
  FakeExtractionModel,
  MemoryProcessorRepository,
  MemoryVocabRepository,
  sequence,
} from '../testing/fakes';
import { DESCRIPTION, generatorOutput, mf } from '../testing/generator-output';
import {
  PROVIDER_PAUSE_MS,
  ProcessorGuard,
  USAGE_LIMIT_FALLBACK_MS,
} from './processor-guard.service';
import { createProcessorService } from './processor.service';

const EXT = 'anthropic/claude-opus-5.5';
const NOW = new Date('2026-11-02T10:00:00Z');
const now = () => NOW;

const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
};

/** A valid generator output for `DESCRIPTION`. */
const opusOutput = (_req: unknown, patch: Record<string, unknown> = {}) =>
  generatorOutput(patch);

describe('ProcessorService', () => {
  let repo: MemoryProcessorRepository;
  let vocab: MemoryVocabRepository;
  let extraction: FakeExtractionModel;

  const service = () =>
    createProcessorService({ repo, vocab, extraction, config, now });
  const addJob = (id = 'job-1', p = {}) =>
    repo.addJob({ id, descriptionText: DESCRIPTION, ...p });
  const job = (id = 'job-1') => {
    const found = repo.jobs.get(id);
    if (!found) throw new Error(`no job ${id}`);
    return found;
  };

  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    repo = new MemoryProcessorRepository(now);
    vocab = new MemoryVocabRepository();
    extraction = new FakeExtractionModel((_, req) => opusOutput(req), EXT);
  });

  it('happy path: one generation, one extraction', async () => {
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(extraction.calls).toHaveLength(1);
    expect(repo.extractions).toHaveLength(1);
    const saved = repo.extractions[0];
    expect(saved.jobId).toBe('job-1');
    expect(saved.extractionModel).toBe(EXT);
    expect(saved.costUsd).toBeCloseTo(0.01);
    expect(saved.seniority).toBe('senior');
    expect(saved.techTags).toEqual(['nodejs', 'postgresql']);
    // A region place stays a region: it is not expanded into countries.
    expect(saved.regionCodes).toEqual(['EMEA']);
    expect(saved.countryCodes).toEqual([]);
    expect(repo.attempts.map((a) => [a.step, a.outcome, a.model])).toEqual([
      ['generation', 'ok', EXT],
    ]);
    expect(saved.data.seniority).toMatchObject({
      decidedBy: 'generator',
      model: EXT,
      confidence: 'sure',
    });
    expect(saved.data.models).toEqual({ generator: EXT });
    expect(extractionDocumentSchema.safeParse(saved.data).success).toBe(true);
    for (const a of repo.attempts) {
      expect(a.extractionId).toBe(saved.id);
      expect(a.jobId).toBe('job-1');
      expect(a.eval).toBe(false);
    }
    expect(job().processingStatus).toBe('processed');
    expect(job().currentExtractionId).toBe(saved.id);
    expect(vocab.row('techTags', 'nodejs')?.occurrences).toBe(1);
    expect(vocab.row('seniorities', 'senior')?.occurrences).toBe(1);
  });

  it('reuse: a second job with the same input is copied, with no model call', async () => {
    addJob('job-1');
    addJob('job-2');
    await service().process('job-1');
    await expect(service().process('job-2')).resolves.toBe('reused');

    expect(extraction.calls).toHaveLength(1);
    expect(repo.attempts).toHaveLength(1);
    expect(repo.extractions).toHaveLength(2);
    const copy = repo.extractions[1];
    expect(copy.jobId).toBe('job-2');
    expect(copy.costUsd).toBe(0);
    expect(job('job-2').processingStatus).toBe('processed');
    expect(job('job-2').currentExtractionId).toBe(copy.id);
  });

  it('reuse: a reopened job with unchanged input links its own extraction', async () => {
    addJob();
    await service().process('job-1');
    const first = job().currentExtractionId;
    repo.reopen('job-1');
    await expect(service().process('job-1')).resolves.toBe('reused');
    expect(repo.extractions).toHaveLength(1);
    expect(job().currentExtractionId).toBe(first);
    expect(extraction.calls).toHaveLength(1);
  });

  it('closed job: processed with no extraction and no model call', async () => {
    addJob('job-1', { closed: true });
    await expect(service().process('job-1')).resolves.toBe('closed');
    expect(extraction.calls).toHaveLength(0);
    expect(job().processingStatus).toBe('processed');
    expect(job().currentExtractionId).toBeNull();
    expect(repo.extractions).toHaveLength(0);
  });

  it('null description: processes, and the saved document validates', async () => {
    addJob('job-1', { descriptionText: null });
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls[0].input.description).toBe('');
    const saved = repo.extractions[0];
    expect(extractionDocumentSchema.safeParse(saved.data).success).toBe(true);
    // Quotes from the description are not in the input: cleared and counted.
    expect(saved.data.arrangement.quote).toBe('');
    expect(repo.attempts[0].quoteFailures).toBeGreaterThan(0);
  });

  it('schema-invalid then valid: a generation_retry with the errors', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      (_, req) =>
        n++ === 0
          ? opusOutput(req, { seniority: mf('wizard') })
          : opusOutput(req),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls).toHaveLength(2);
    expect(extraction.calls[0].req.retryErrors).toBeUndefined();
    const retryErrors = extraction.calls[1].req.retryErrors ?? [];
    expect(retryErrors.length).toBeGreaterThan(0);
    expect(retryErrors.join('\n')).toContain('seniority.value');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
    ]);
    expect(repo.extractions[0].costUsd).toBeCloseTo(0.02);
  });

  it('unparseable output (ModelOutputError) also gets the schema-fix retry', async () => {
    const calls = sequence<unknown>(
      new ModelOutputError('Extraction is not valid JSON', { costUsd: 0.5 }),
      'ok',
    );
    extraction = new FakeExtractionModel((_, req) => {
      calls();
      return opusOutput(req);
    }, EXT);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls[1].req.retryErrors).toEqual([
      'Extraction is not valid JSON',
    ]);
    const invalid = repo.attempts[0];
    expect([invalid.step, invalid.outcome, invalid.costUsd]).toEqual([
      'generation',
      'invalid',
      0.5,
    ]);
    expect(invalid.model).toBe(EXT);
  });

  it('invalid on every try: failed, with the Zod path in processingError', async () => {
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, { seniority: mf('wizard') }),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(extraction.calls).toHaveLength(3);
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('seniority.value');
    expect(repo.extractions).toHaveLength(0);
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
    expect(repo.attempts.every((a) => a.extractionId === null)).toBe(true);
  });

  it('transient on attempt 1 of 3: retry, back to pending', async () => {
    extraction = new FakeExtractionModel(() => {
      throw new TransientModelError('429', { costUsd: 0, latencyMs: 5 });
    }, EXT);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('retry');
    expect(job().processingStatus).toBe('pending');
    expect(job().processingError).toContain('429');
    const failed = repo.attempts[0];
    expect([failed.step, failed.outcome, failed.model]).toEqual([
      'generation',
      'error',
      EXT,
    ]);
    expect(failed.inputTokens).toBe(0);
    expect(failed.latencyMs).toBe(5);
  });

  it('transient on attempt 3 of 3: failed', async () => {
    extraction = new FakeExtractionModel(() => {
      throw new TransientModelError('503');
    }, EXT);
    addJob('job-1', { processingAttempts: 2 });
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('503');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'error'],
    ]);
  });

  it('a request error fails the job at once', async () => {
    extraction = new FakeExtractionModel(() => {
      throw new ModelRequestError('400 bad schema');
    }, EXT);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(job().processingError).toContain('400 bad schema');
    expect(repo.attempts.map((a) => a.outcome)).toEqual(['error']);
  });

  const cityOpening = (countryCode: string) => ({
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'city', name: 'London', countryCode }],
        placeStrictness: 'limit',
        timezones: [],
        quote: '',
        confidence: 'sure',
      },
    ],
  });
  /** Passes the model schema but fails the document's own check. */
  const badStrictness = {
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'unstated',
        timezones: [],
        quote: '',
        confidence: 'sure',
      },
    ],
  };

  it('an unknown city country code is a schema error: retried, then processed', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, cityOpening(n++ === 0 ? 'UK' : 'GB')),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls[1].req.retryErrors?.join('\n')).toContain(
      'openings.0.places.0.countryCode',
    );
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
    ]);
    expect(repo.extractions[0].countryCodes).toEqual(['GB']);
  });

  it('an unapproved code caught by resolveTerms takes the retry, then processes', async () => {
    // A code the model schema offers but the matching forms do not approve.
    const snapshot = vocab.snapshot.bind(vocab);
    vocab.snapshot = async () => {
      const v = await snapshot();
      v.options.countries.push('XX');
      return v;
    };
    let n = 0;
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, cityOpening(n++ === 0 ? 'XX' : 'GB')),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls[1].req.retryErrors).toEqual([
      'openings.0.places.0.countryCode: "XX" is not an approved countries code',
    ]);
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
    ]);
    expect(repo.attempts[0].error).toContain('openings.0.places.0.countryCode');
  });

  it('a final document check failure takes the retry, then processes', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, n++ === 0 ? badStrictness : {}),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(extraction.calls[1].req.retryErrors?.join('\n')).toContain(
      'openings.0.placeStrictness',
    );
    expect(repo.attempts.map((a) => a.outcome)).toEqual(['invalid', 'ok']);
  });

  it('a post-merge error on every try: failed', async () => {
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, badStrictness),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(extraction.calls).toHaveLength(3);
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('openings.0.placeStrictness');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
    expect(repo.extractions).toHaveLength(0);
  });

  it("a failed attempts write keeps the run's attempts for the failure path", async () => {
    addJob();
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const record = repo.recordAttempts.bind(repo);
    let calls = 0;
    repo.recordAttempts = async (rows) => {
      if (calls++ === 0) throw new Error('db down');
      return record(rows);
    };
    await expect(service().process('job-1')).resolves.toBe('retry');
    expect(repo.attempts.map((a) => a.step)).toEqual(['generation']);
    expect(job().processingStatus).toBe('pending');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('over budget: no claim', async () => {
    repo.addSpend(20, new Date('2026-11-02T00:00:01Z'));
    addJob();
    await expect(service().process('job-1')).resolves.toBe('over_budget');
    expect(repo.log).not.toContain('claim');
    expect(job().processingStatus).toBe('pending');
    expect(extraction.calls).toHaveLength(0);
  });

  it('over budget: warns once per UTC day', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let at = NOW;
    repo.addSpend(20, new Date('2026-11-02T00:00:01Z'));
    repo.addSpend(20, new Date('2026-11-03T00:00:01Z'));
    addJob();
    const svc = createProcessorService({
      repo,
      vocab,
      extraction,
      config,
      now: () => at,
    });
    await svc.process('job-1');
    await svc.process('job-1');
    expect(warn).toHaveBeenCalledTimes(1);
    at = new Date('2026-11-03T10:00:00Z');
    await svc.process('job-1');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  describe('provider unavailable (401/402/403)', () => {
    const refusing = () =>
      new FakeExtractionModel(() => {
        throw new ProviderUnavailableError('402 no credit', { latencyMs: 3 });
      }, EXT);

    it('returns the job to pending without using an attempt, and pauses', async () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      extraction = refusing();
      addJob('job-1', { processingAttempts: 2 });
      addJob('job-2');
      let at = NOW;
      const svc = createProcessorService({
        repo,
        vocab,
        extraction,
        config,
        now: () => at,
      });

      await expect(svc.process('job-1')).resolves.toBe('provider_unavailable');
      expect(job()).toMatchObject({
        processingStatus: 'pending',
        processingAttempts: 2,
        processingError: '402 no credit',
      });
      expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
        ['generation', 'error'],
      ]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(svc.isPaused()).toBe(true);

      // Paused: nothing is claimed, not even the budget is read.
      repo.log.length = 0;
      await expect(svc.process('job-2')).resolves.toBe('paused');
      expect(repo.log).toEqual([]);
      expect(job('job-2').processingStatus).toBe('pending');

      at = new Date(NOW.getTime() + PROVIDER_PAUSE_MS);
      expect(svc.isPaused()).toBe(false);
      await expect(svc.process('job-2')).resolves.toBe('provider_unavailable');
      // A new pause, logged once more.
      expect(error).toHaveBeenCalledTimes(2);
    });
  });

  it("yesterday's spend does not count against today's budget", async () => {
    repo.addSpend(50, new Date('2026-11-01T23:59:59Z'));
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
  });

  it('not claimable: not_claimed', async () => {
    addJob('job-1', { processingStatus: 'processing' });
    await expect(service().process('job-1')).resolves.toBe('not_claimed');
    expect(extraction.calls).toHaveLength(0);
  });

  it('unknown tech term: proposed, unmatched, not in techTags', async () => {
    extraction = new FakeExtractionModel(
      (_, req) =>
        opusOutput(req, {
          techStack: mf({
            requirements: [
              {
                technology: { text: 'Node.js', code: null },
                kind: 'main',
                importance: 9,
                domain: null,
                years: null,
                quote: 'Node.js',
                confidence: 'sure',
                group: null,
              },
              {
                technology: { text: 'Frobnicator', code: null },
                kind: 'nice',
                importance: 2,
                domain: null,
                years: null,
                quote: '',
                confidence: 'sure',
                group: null,
              },
            ],
            groups: [],
          }),
        }),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(vocab.row('techTags', 'frobnicator')?.status).toBe('proposed');
    const saved = repo.extractions[0];
    expect(saved.data.unmatched).toContainEqual({
      list: 'techTags',
      text: 'Frobnicator',
      at: 'techStack.requirements.1.technology',
    });
    expect(saved.techTags).toEqual(['nodejs']);
  });

  it('city places get their city id', async () => {
    extraction = new FakeExtractionModel(
      (_, req) =>
        opusOutput(req, {
          openings: [
            {
              arrangements: ['remote'],
              places: [{ kind: 'city', name: 'Berlin', countryCode: 'DE' }],
              placeStrictness: 'limit',
              timezones: [],
              quote: '',
              confidence: 'sure',
            },
          ],
        }),
      EXT,
    );
    addJob();
    await service().process('job-1');
    const [city] = vocab.cities;
    expect(city.name).toBe('Berlin');
    expect(repo.extractions[0].cityIds).toEqual([city.id]);
  });

  it('superseded: the job was reopened meanwhile; the extraction is saved', async () => {
    extraction = new FakeExtractionModel((input, req) => {
      repo.reopen(input.jobId);
      return opusOutput(req);
    }, EXT);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('superseded');
    expect(repo.extractions).toHaveLength(1);
    expect(job().processingStatus).toBe('pending');
    expect(job().currentExtractionId).toBe(repo.extractions[0].id);
  });

  it('logs the run: claim, each model call, and the outcome with time and cost', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    addJob();
    await service().process('job-1');

    const run = lines.filter((l) => l.startsWith('[job job-1]'));
    expect(run.map((l) => l.replace(/ \(.*$| ok in .*$| in .*$/, ''))).toEqual([
      '[job job-1] claimed',
      `[job job-1] generation → ${EXT}`,
      '[job job-1] generation',
      '[job job-1] processed',
    ]);
    expect(run.at(-1)).toMatch(
      /processed in \d+\.\ds · \$\d+\.\d{6} · extraction /,
    );
  });

  it('logs why a failed run stops, with the call that failed', async () => {
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => {
      warnings.push(String(m));
    });
    addJob();
    extraction = new FakeExtractionModel(() => {
      throw new ModelRequestError(
        'chat completions (x): OpenRouter returned 422: bad schema',
      );
    }, EXT);
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(warnings).toEqual([
      expect.stringMatching(
        /^\[job job-1\] generation failed after .*OpenRouter returned 422: bad schema$/,
      ),
      expect.stringMatching(
        /^\[job job-1\] failed for good after .*OpenRouter returned 422: bad schema$/,
      ),
    ]);
  });

  describe('preview', () => {
    const posting = {
      title: 'Senior Backend Engineer',
      companyName: 'Acme',
      description: DESCRIPTION,
      evidence: { contractType: 'Full-time' },
    };

    it('returns the document, its columns and its calls, and saves no extraction', async () => {
      const result = await service().preview(posting);

      expect(extractionDocumentSchema.safeParse(result.document).success).toBe(
        true,
      );
      expect(result.typedColumns.arrangement).toBe('remote');
      expect(result.calls.map((c) => [c.step, c.outcome])).toEqual([
        ['generation', 'ok'],
      ]);
      expect(result.document.models).toEqual({ generator: EXT });
      expect(repo.extractions).toEqual([]);
      expect(vocab.cities).toEqual([]);
    });

    it('records its calls with no job, so they count against the budget', async () => {
      await service().preview(posting);
      expect(repo.attempts.map((a) => [a.step, a.jobId, a.eval])).toEqual([
        ['generation', null, false],
      ]);
    });

    it('refuses once the budget is spent', async () => {
      repo.addSpend(20);
      await expect(service().preview(posting)).rejects.toMatchObject({
        name: 'ProcessorBlockedError',
        reason: 'over_budget',
      });
      expect(extraction.calls).toHaveLength(0);
    });

    it('pauses and still records the call when the provider refuses the key', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      extraction = new FakeExtractionModel(() => {
        throw new ProviderUnavailableError('OpenRouter returned 401');
      }, EXT);
      const svc = service();
      await expect(svc.preview(posting)).rejects.toBeInstanceOf(
        ProviderUnavailableError,
      );
      expect(svc.isPaused()).toBe(true);
      expect(repo.attempts.map((a) => a.outcome)).toEqual(['error']);
    });
  });

  describe('processNow', () => {
    it('sends a processed job back to pending and processes it again', async () => {
      addJob();
      const svc = service();
      await svc.process('job-1');
      // A new prompt or model would miss the reuse; here the same input is reused.
      const { outcome, job: state } = await svc.processNow('job-1');
      expect(outcome).toBe('reused');
      expect(state?.processingStatus).toBe('processed');
      expect(state?.extraction?.schemaVersion).toBe(EXTRACTION_SCHEMA_VERSION);
      expect(state?.extraction?.data?.seniority.value).toBe('senior');
    });

    it('does not process an out-of-scope job', async () => {
      addJob('post-1', { kind: 'post' });
      const { outcome } = await service().processNow('post-1');
      expect(outcome).toBe('not_claimed');
      expect(extraction.calls).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('counts in-scope jobs per status and reports the spend', async () => {
      addJob('a');
      addJob('b', { processingStatus: 'processed' });
      addJob('c', { processingStatus: null });
      addJob('d', { linkedIn: false });
      repo.addSpend(1.5);

      expect(await service().status()).toEqual({
        models: { extraction: EXT },
        jobs: {
          pending: 1,
          processing: 0,
          processed: 1,
          failed: 0,
          archived: 0,
          unset: 1,
        },
        estimatedCostTodayUsd: 1.5,
        dailyBudgetUsd: 20,
        paused: false,
        pause: null,
        weeklyUtilization: null,
      });
    });
  });
  describe('usage limits', () => {
    const limit = (resetsAt: Date | null): LimitObservation => ({
      kind: 'five_hour',
      status: 'rejected',
      utilization: 1,
      resetsAt,
    });
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    const jobs = ['a', 'b', 'c', 'd'];

    const limited = (resets: (Date | null)[]) => {
      let i = 0;
      extraction = new FakeExtractionModel(() => {
        throw new UsageLimitError('limit reached', limit(resets[i++]));
      }, EXT);
    };
    const expectPendingRefunded = () => {
      for (const id of jobs) {
        expect(job(id)).toMatchObject({
          processingStatus: 'pending',
          processingAttempts: 0,
          processingError: 'limit reached',
        });
      }
    };

    it('in-flight calls with the same reset: pending, refunded, one warn line', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      jobs.forEach((id) => addJob(id));
      const reset = at(3_600_000);
      limited([reset, reset, reset, reset]);
      const svc = service();

      const outcomes = await Promise.all(jobs.map((id) => svc.process(id)));

      expect(outcomes).toEqual(Array(4).fill('usage_limit'));
      expectPendingRefunded();
      expect(svc.isPaused()).toBe(true);
      expect((await svc.status()).pause).toMatchObject({
        until: reset,
        reason: 'usage_limit',
      });
      const pauseLines = warn.mock.calls.filter(([m]) =>
        String(m).includes('paused until'),
      );
      expect(pauseLines).toHaveLength(1);
    });

    it('in-flight calls with different resets: paused until the latest', async () => {
      jobs.forEach((id) => addJob(id));
      const ends = [1, 2, 3, 4].map((h) => at(h * 3_600_000));
      limited(ends);
      const svc = service();

      await Promise.all(jobs.map((id) => svc.process(id)));

      expectPendingRefunded();
      expect((await svc.status()).pause?.until).toEqual(ends[3]);
    });

    it('a limit with no reset time pauses 15 minutes', async () => {
      addJob('a');
      limited([null]);
      const svc = service();
      await expect(svc.process('a')).resolves.toBe('usage_limit');
      expect((await svc.status()).pause?.until).toEqual(
        at(USAGE_LIMIT_FALLBACK_MS),
      );
    });

    it('a fresh guard (restart) that hits the limit pauses again', async () => {
      addJob('a');
      limited([at(60_000)]);
      const svc = service();
      expect(svc.isPaused()).toBe(false);
      await expect(svc.process('a')).resolves.toBe('usage_limit');
      expect(job('a')).toMatchObject({
        processingStatus: 'pending',
        processingAttempts: 0,
      });
      expect(svc.isPaused()).toBe(true);
    });

    it('a successful call that sees weekly 0.85: processed, then paused', async () => {
      addJob('a');
      const reset = at(86_400_000);
      const guard = new ProcessorGuard(repo, config, now);
      extraction = new FakeExtractionModel((_, req) => {
        guard.observeLimits([
          {
            kind: 'weekly',
            status: 'allowed_warning',
            utilization: 0.85,
            resetsAt: reset,
          },
        ]);
        return opusOutput(req);
      }, EXT);
      const svc = createProcessorService({
        repo,
        vocab,
        extraction,
        config,
        now,
        guard,
      });

      await expect(svc.process('a')).resolves.toBe('processed');
      expect(job('a').processingStatus).toBe('processed');
      expect(await svc.status()).toMatchObject({
        paused: true,
        weeklyUtilization: 0.85,
        pause: { until: reset, reason: 'weekly_reserve' },
      });
    });
  });
});
