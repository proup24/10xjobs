import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import type { DecisionAnswer, DecisionQuestion } from '../models/types';
import { extractionDocumentSchema } from '../schema';
import {
  FakeDecisionModel,
  FakeExtractionModel,
  MemoryProcessorRepository,
  MemoryVocabRepository,
  sequence,
} from '../testing/fakes';
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
};

const DESCRIPTION =
  'Senior Backend Engineer, remote in EMEA. Full-time employee role. We use Node.js and PostgreSQL.';

/** What Jev and Opus answer for each closed question in these tests. */
const CLOSED: Record<string, string | boolean> = {
  arrangement: 'remote',
  seniority: 'senior',
  roleKind: 'backend_engineer',
  contractType: 'full_time',
  engagement: 'employee',
  isSoftwareEngineeringRole: true,
  sponsorshipOffered: 'unstated',
};
const closedValue = (key: string) =>
  key.startsWith('junk:') ? false : CLOSED[key];

/** Confident answers to every question; `scores` overrides one key's score. */
const jev =
  (scores: Record<string, number> = {}) =>
  (_: unknown, questions: DecisionQuestion[]): DecisionAnswer[] =>
    questions.map((q) => ({
      key: q.key,
      value: closedValue(q.key),
      score: scores[q.key] ?? 0.95,
    }));

const mf = <T>(value: T, quote = '', confidence = 'sure') => ({
  value,
  quote,
  confidence,
});

type Req = { jsonSchema: object; retryErrors?: string[] };

/** The keys of the fallback questions in a request's JSON schema. */
const fallbackKeys = (req: Req): string[] =>
  Object.keys(
    (
      req.jsonSchema as {
        properties: { fallback: { properties?: Record<string, unknown> } };
      }
    ).properties.fallback.properties ?? {},
  );

/** A valid Opus output for `DESCRIPTION`; answers every fallback question asked. */
function opusOutput(req: Req, patch: Record<string, unknown> = {}) {
  const fallback = Object.fromEntries(
    fallbackKeys(req).map((k) => [k, mf(closedValue(k), '', 'sure')]),
  );
  if (fallback.seniority) fallback.seniority = mf('senior', 'Senior');
  return {
    position: mf(
      { roleKind: 'backend_engineer', title: 'Backend Engineer' },
      'Senior Backend Engineer',
    ),
    isSoftwareEngineeringRole: mf(true, 'Backend Engineer'),
    seniority: mf('senior', 'Senior'),
    yearsRequired: mf(null),
    arrangement: mf('remote', 'remote in EMEA'),
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'limit',
        timezones: [],
        quote: 'remote in EMEA',
        confidence: 'sure',
      },
    ],
    contractType: mf('full_time', 'Full-time'),
    engagement: mf('employee', 'employee'),
    contractMonths: mf(null),
    salary: mf(null),
    techStack: mf(
      {
        mainStack: [{ anyOf: [{ text: 'Node.js', code: null }] }],
        mustHaves: [],
        niceToHaves: [{ text: 'PostgreSQL', code: 'postgresql' }],
      },
      'We use Node.js and PostgreSQL',
    ),
    requiredLanguages: mf([]),
    workAuthorization: mf({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: mf([]),
    fallback,
    ...patch,
  };
}

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
    decision = new FakeDecisionModel(jev(), DEC);
    extraction = new FakeExtractionModel((_, req) => opusOutput(req), EXT);
  });

  it('happy path: one call per model, one extraction, two attempts', async () => {
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
    expect(saved.countryCodes).toContain('DE');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['decision', 'ok'],
      ['extraction', 'ok'],
    ]);
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

  it('confident Jev, no fallback: the request schema has an empty fallback', async () => {
    addJob();
    await service().process('job-1');
    expect(fallbackKeys(extraction.calls[0].req)).toEqual([]);
    expect(repo.extractions[0].data.seniority.decidedBy).toBe('jev');
  });

  it('low-confidence seniority goes to Opus', async () => {
    decision = new FakeDecisionModel(jev({ seniority: 0.4 }), DEC);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');
    expect(fallbackKeys(extraction.calls[0].req)).toEqual(['seniority']);
    const fact = repo.extractions[0].data.seniority;
    expect(fact.decidedBy).toBe('opus');
    expect(fact.value).toBe('senior');
    expect(fact.score).toBe(0.4);
  });

  it('reuse: a second job with the same input is copied, with no model call', async () => {
    addJob('job-1');
    addJob('job-2');
    await service().process('job-1');
    await expect(service().process('job-2')).resolves.toBe('reused');

    expect(decision.calls).toHaveLength(1);
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
    expect(decision.calls[0].input.description).toBe('');
    const saved = repo.extractions[0];
    expect(extractionDocumentSchema.safeParse(saved.data).success).toBe(true);
    // Quotes from the description are not in the input: cleared and counted.
    expect(saved.data.arrangement.quote).toBe('');
    expect(repo.attempts[1].quoteFailures).toBeGreaterThan(0);
  });

  it('schema-invalid then valid: one retry with the errors', async () => {
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
      ['decision', 'ok'],
      ['extraction', 'invalid'],
      ['extraction_retry', 'ok'],
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
    const invalid = repo.attempts[1];
    expect([invalid.step, invalid.outcome, invalid.costUsd]).toEqual([
      'extraction',
      'invalid',
      0.5,
    ]);
    expect(invalid.model).toBe(EXT);
  });

  it('invalid twice: failed, with the Zod path in processingError', async () => {
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, { seniority: mf('wizard') }),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(extraction.calls).toHaveLength(2);
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('seniority.value');
    expect(repo.extractions).toHaveLength(0);
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['decision', 'ok'],
      ['extraction', 'invalid'],
      ['extraction_retry', 'invalid'],
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
    const failed = repo.attempts[1];
    expect([failed.step, failed.outcome, failed.model]).toEqual([
      'extraction',
      'error',
      EXT,
    ]);
    expect(failed.inputTokens).toBe(0);
    expect(failed.latencyMs).toBe(5);
  });

  it('transient on attempt 3 of 3: failed', async () => {
    decision = new FakeDecisionModel(() => {
      throw new TransientModelError('503');
    }, DEC);
    addJob('job-1', { processingAttempts: 2 });
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('503');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['decision', 'error'],
    ]);
    expect(extraction.calls).toHaveLength(0);
  });

  it('a request error fails the job at once', async () => {
    extraction = new FakeExtractionModel(() => {
      throw new ModelRequestError('400 bad schema');
    }, EXT);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(job().processingError).toContain('400 bad schema');
    expect(repo.attempts.map((a) => a.outcome)).toEqual(['ok', 'error']);
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
      ['decision', 'ok'],
      ['extraction', 'invalid'],
      ['extraction_retry', 'ok'],
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
      ['decision', 'ok'],
      ['extraction', 'invalid'],
      ['extraction_retry', 'ok'],
    ]);
    expect(repo.attempts[1].error).toContain('openings.0.places.0.countryCode');
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
      'ok',
      'invalid',
      'ok',
    ]);
  });

  it('a post-merge error on the retry too: failed', async () => {
    extraction = new FakeExtractionModel(
      (_, req) => opusOutput(req, badStrictness),
      EXT,
    );
    addJob();
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(extraction.calls).toHaveLength(2);
    expect(job().processingStatus).toBe('failed');
    expect(job().processingError).toContain('openings.0.placeStrictness');
    expect(repo.attempts.map((a) => [a.step, a.outcome])).toEqual([
      ['decision', 'ok'],
      ['extraction', 'invalid'],
      ['extraction_retry', 'invalid'],
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
      'decision',
      'extraction',
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
    expect(decision.calls).toHaveLength(0);
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
        ['decision', 'ok'],
        ['extraction', 'error'],
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
        throw new ProviderUnavailableError('401 bad key');
      }, DEC);
      addJob();
      await expect(service().process('job-1')).resolves.toBe(
        'provider_unavailable',
      );
      expect(job()).toMatchObject({
        processingStatus: 'pending',
        processingAttempts: 0,
      });
      expect(extraction.calls).toHaveLength(0);
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
    expect(decision.calls).toHaveLength(0);
  });

  it('unknown tech term: proposed, unmatched, not in techTags', async () => {
    extraction = new FakeExtractionModel(
      (_, req) =>
        opusOutput(req, {
          techStack: mf({
            mainStack: [{ anyOf: [{ text: 'Node.js', code: null }] }],
            mustHaves: [],
            niceToHaves: [{ text: 'Frobnicator', code: null }],
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
      at: 'techStack.niceToHaves.0',
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

  it('malformed Jev answers (ModelOutputError): every closed question goes to Opus', async () => {
    decision = new FakeDecisionModel(() => {
      throw new ModelOutputError('no usable answers', {
        costUsd: 0.002,
        providerRequestId: 'jev-req',
      });
    }, DEC);
    addJob();
    await expect(service().process('job-1')).resolves.toBe('processed');

    const questions = decision.calls[0].questions.map((q) => q.key);
    expect(fallbackKeys(extraction.calls[0].req).sort()).toEqual(
      [...questions].sort(),
    );
    const [jevAttempt] = repo.attempts;
    expect(jevAttempt).toMatchObject({
      step: 'decision',
      outcome: 'invalid',
      model: DEC,
      costUsd: 0.002,
      providerRequestId: 'jev-req',
      error: 'no usable answers',
    });
    const doc = repo.extractions[0].data;
    expect(doc.seniority.decidedBy).toBe('opus');
    expect(doc.arrangement.decidedBy).toBe('opus');
    expect(job().processingStatus).toBe('processed');
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
      `[job job-1] decision → ${DEC}`,
      '[job job-1] decision',
      `[job job-1] extraction → ${EXT}`,
      '[job job-1] extraction',
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
        /^\[job job-1\] extraction failed after .*OpenRouter returned 422: bad schema$/,
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
        ['decision', 'ok'],
        ['extraction', 'ok'],
      ]);
      expect(repo.extractions).toEqual([]);
      expect(vocab.cities).toEqual([]);
    });

    it('records its calls with no job, so they count against the budget', async () => {
      await service().preview(posting);
      expect(repo.attempts.map((a) => [a.step, a.jobId, a.eval])).toEqual([
        ['decision', null, false],
        ['extraction', null, false],
      ]);
    });

    it('refuses once the budget is spent', async () => {
      repo.addSpend(20);
      await expect(service().preview(posting)).rejects.toMatchObject({
        name: 'ProcessorBlockedError',
        reason: 'over_budget',
      });
      expect(decision.calls).toHaveLength(0);
    });

    it('pauses and still records the call when the provider refuses the key', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      decision = new FakeDecisionModel(() => {
        throw new ProviderUnavailableError('OpenRouter returned 401');
      }, DEC);
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
      expect(state?.extraction?.data.seniority.value).toBe('senior');
    });

    it('does not process an out-of-scope job', async () => {
      addJob('post-1', { kind: 'post' });
      const { outcome } = await service().processNow('post-1');
      expect(outcome).toBe('not_claimed');
      expect(decision.calls).toHaveLength(0);
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
        jobs: { pending: 1, processing: 0, processed: 1, failed: 0, unset: 1 },
        spentTodayUsd: 1.5,
        dailyBudgetUsd: 20,
        paused: false,
      });
    });
  });
});
