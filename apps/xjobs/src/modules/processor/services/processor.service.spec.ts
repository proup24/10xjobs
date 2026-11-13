import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import { extractionDocumentSchema } from '../schema';
import {
  FakeDecisionModel,
  FakeExtractionModel,
  MemoryProcessorRepository,
  MemoryVocabRepository,
  sequence,
} from '../testing/fakes';
import {
  DESCRIPTION,
  generatorOutput,
  jevAnswers,
  mf,
} from '../testing/generator-output';
import { needsReview } from '../rules/validate';
import { PROVIDER_PAUSE_MS } from './processor-guard.service';
import { createProcessorService } from './processor.service';

const DEC = 'typesafe/jev-1.14';
const EXT = 'anthropic/claude-opus-5.5';
const NOW = new Date('2026-11-02T10:00:00Z');
const now = () => NOW;

const config: ProcessorConfig = {
  decisionModel: DEC,
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  maxRegenerations: 2,
  generationTries: 3,
};

/** A valid generator output for `DESCRIPTION`. */
const opusOutput = (_req: unknown, patch: Record<string, unknown> = {}) =>
  generatorOutput(patch);

describe('ProcessorService', () => {
  let repo: MemoryProcessorRepository;
  let vocab: MemoryVocabRepository;
  let decision: FakeDecisionModel;
  let extraction: FakeExtractionModel;

  const service = () =>
    createProcessorService({ repo, vocab, decision, extraction, config, now });
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
    decision = new FakeDecisionModel(jevAnswers(), DEC);
    extraction = new FakeExtractionModel((_, req) => opusOutput(req), EXT);
  });

  it('happy path: one generation, one verification, one extraction', async () => {
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(decision.calls).toHaveLength(1);
    expect(extraction.calls).toHaveLength(1);
    expect(repo.extractions).toHaveLength(1);
    const saved = repo.extractions[0];
    expect(saved.jobId).toBe('job-1');
    expect(saved.decisionModel).toBe(DEC);
    expect(saved.extractionModel).toBe(EXT);
    expect(saved.costUsd).toBeCloseTo(0.02);
    expect(saved.seniority).toBe('senior');
    expect(saved.techTags).toEqual(['nodejs', 'postgresql']);
    // A region place stays a region: it is not expanded into countries.
    expect(saved.regionCodes).toEqual(['EMEA']);
    expect(saved.countryCodes).toEqual([]);
    expect(repo.attempts.map((a) => [a.step, a.outcome, a.model])).toEqual([
      ['generation', 'ok', EXT],
      ['verification', 'ok', DEC],
    ]);
    expect(saved.data.seniority).toMatchObject({
      decidedBy: 'generator',
      model: EXT,
      confidence: 'sure',
      verification: { verdict: 'confirmed', jevPick: 'senior', rounds: 1 },
    });
    expect(saved.data.models).toEqual({ verifier: DEC, generator: EXT });
    expect(saved.data.verification).toMatchObject({ rounds: 1, dropped: [] });
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

  it('confident Jev: every closed fact is confirmed and sure, and Jev never sees the generator values', async () => {
    addJob();
    await service().process('job-1');

    const { data, needsReview: review } = repo.extractions[0];
    for (const fact of [
      data.arrangement,
      data.seniority,
      data.position,
      data.contractType,
      data.engagement,
      data.isSoftwareEngineeringRole,
      data.workAuthorization,
      data.junkFlags,
    ])
      expect(fact).toMatchObject({
        confidence: 'sure',
        score: 0.95,
        verification: { verdict: 'confirmed', score: 0.95 },
      });
    expect(review).toBe(false);
    const questions = decision.calls[0].questions;
    expect(questions.every((q) => q.kind === 'choice')).toBe(true);
    expect(JSON.stringify(questions)).not.toContain('Backend Engineer');
    expect(extraction.calls[0].req.feedback).toBeUndefined();
  });

  it('low-confidence seniority: kept as unsure, no regeneration, needs review', async () => {
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid', score: 0.3 } }),
      DEC,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(extraction.calls).toHaveLength(1);
    expect(decision.calls).toHaveLength(1);
    const saved = repo.extractions[0];
    expect(saved.seniority).toBe('senior');
    expect(saved.data.seniority).toMatchObject({
      value: 'senior',
      confidence: 'unsure',
      score: 0.3,
      verification: { verdict: 'unconfirmed', jevPick: 'mid' },
    });
    expect(saved.needsReview).toBe(true);
  });

  it('rejected seniority: regenerated with feedback, then confirmed', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      (_, req) =>
        opusOutput(req, n++ === 0 ? {} : { seniority: mf('mid', 'Senior') }),
      EXT,
    );
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid' } }),
      DEC,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(extraction.calls[1].req.feedback?.map((v) => v.key)).toEqual([
      'seniority',
    ]);
    expect(decision.calls[1].questions.map((q) => q.key)).toEqual([
      'seniority',
    ]);
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'ok'],
      ['verification', 'ok'],
      ['generation', 'ok'],
      ['verification', 'ok'],
    ]);
    const saved = repo.extractions[0];
    expect(saved.seniority).toBe('mid');
    expect(saved.costUsd).toBeCloseTo(0.04);
    expect(saved.data.verification.rounds).toBe(2);
  });

  it('rejected in every round: dropped to unstated, also in its column, needs review', async () => {
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid' } }),
      DEC,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(extraction.calls).toHaveLength(3);
    expect(decision.calls).toHaveLength(3);
    const saved = repo.extractions[0];
    // The typed column is derived as today: a dropped list field is `unstated`.
    expect(saved.seniority).toBe('unstated');
    expect(saved.data.seniority.value).toBe('unstated');
    expect(saved.data.verification.dropped).toEqual([
      { field: 'seniority', generatorValue: 'senior', jevPick: 'mid' },
    ]);
    expect(saved.needsReview).toBe(true);
    expect(needsReview(saved.data)).toBe(true);
  });

  it('reuse: a second job with the same input is copied, with no model call', async () => {
    addJob('job-1');
    addJob('job-2');
    await service().process('job-1');
    await expect(service().process('job-2')).resolves.toBe('reused');

    expect(extraction.calls).toHaveLength(1);
    expect(repo.attempts).toHaveLength(2);
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
    expect(decision.calls).toHaveLength(0);
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
      ['verification', 'ok'],
    ]);
    expect(repo.extractions[0].costUsd).toBeCloseTo(0.03);
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
    expect(decision.calls).toHaveLength(0);
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
      ['verification', 'ok'],
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
      ['verification', 'ok'],
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
    expect(repo.attempts.map((a) => a.outcome)).toEqual([
      'invalid',
      'ok',
      'ok',
    ]);
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
    expect(repo.attempts.map((a) => a.step)).toEqual([
      'generation',
      'verification',
    ]);
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
      decision,
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
        decision,
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

    it('a 401 from Jev is handled the same way', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      decision = new FakeDecisionModel(() => {
        throw new ProviderUnavailableError('OpenRouter returned 401');
      }, DEC);
      addJob();
      const svc = service();

      await expect(svc.process('job-1')).resolves.toBe('provider_unavailable');
      expect(job()).toMatchObject({
        processingStatus: 'pending',
        processingAttempts: 0,
        processingError: 'OpenRouter returned 401',
      });
      expect(repo.attempts.map((a) => [a.step, a.outcome, a.model])).toEqual([
        ['generation', 'ok', EXT],
        ['verification', 'error', DEC],
      ]);
      expect(repo.extractions).toHaveLength(0);
      expect(svc.isPaused()).toBe(true);
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

  it('malformed Jev answers (ModelOutputError): every closed fact unconfirmed, processed for review', async () => {
    decision = new FakeDecisionModel(() => {
      throw new ModelOutputError('Decisions API returned no answers', {
        costUsd: 0.003,
      });
    }, DEC);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    expect(extraction.calls).toHaveLength(1);
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['generation', 'ok'],
      ['verification', 'invalid'],
    ]);
    const saved = repo.extractions[0];
    expect(saved.costUsd).toBeCloseTo(0.013);
    expect(saved.seniority).toBe('senior');
    expect(saved.data.seniority).toMatchObject({
      confidence: 'unsure',
      verification: { verdict: 'unconfirmed', jevPick: null, score: null },
    });
    expect(saved.needsReview).toBe(true);
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
      `[job job-1] verification → ${DEC}`,
      '[job job-1] verification',
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
        ['verification', 'ok'],
      ]);
      expect(result.document.models.verifier).toBe(DEC);
      expect(repo.extractions).toEqual([]);
      expect(vocab.cities).toEqual([]);
    });

    it('records its calls with no job, so they count against the budget', async () => {
      await service().preview(posting);
      expect(repo.attempts.map((a) => [a.step, a.jobId, a.eval])).toEqual([
        ['generation', null, false],
        ['verification', null, false],
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
      expect(state?.extraction?.schemaVersion).toBe(3);
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
        models: { decision: DEC, extraction: EXT },
        jobs: { pending: 1, processing: 0, processed: 1, failed: 0, archived: 0, unset: 1 },
        spentTodayUsd: 1.5,
        dailyBudgetUsd: 20,
        paused: false,
      });
    });
  });
});
