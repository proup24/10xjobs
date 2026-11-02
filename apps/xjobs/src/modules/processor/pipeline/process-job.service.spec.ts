import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import {
  ModelOutputError,
  ModelRequestError,
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
import { ProcessJobService } from './process-job.service';

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

describe('ProcessJobService', () => {
  let repo: MemoryProcessorRepository;
  let vocab: MemoryVocabRepository;
  let decision: FakeDecisionModel;
  let extraction: FakeExtractionModel;

  const service = () =>
    new ProcessJobService(repo, vocab, decision, extraction, config, now);
  const addJob = (id = 'job-1', p = {}) =>
    repo.addJob({ id, descriptionText: DESCRIPTION, ...p });
  const job = (id = 'job-1') => {
    const found = repo.jobs.get(id);
    if (!found) throw new Error(`no job ${id}`);
    return found;
  };

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

  it('an unapproved code after the merge fails the job', async () => {
    extraction = new FakeExtractionModel(
      (_, req) =>
        opusOutput(req, {
          openings: [
            {
              arrangements: ['remote'],
              places: [{ kind: 'city', name: 'Atlantis', countryCode: 'XX' }],
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
    await expect(service().process('job-1')).resolves.toBe('failed');
    expect(job().processingError).toContain('openings.0.places.0.countryCode');
    expect(repo.attempts.map((a) => a.outcome)).toEqual(['ok', 'invalid']);
    expect(repo.extractions).toHaveLength(0);
  });

  it('over budget: no claim', async () => {
    repo.addSpend(20, new Date('2026-11-02T00:00:01Z'));
    addJob();
    await expect(service().process('job-1')).resolves.toBe('over_budget');
    expect(repo.log).not.toContain('claim');
    expect(job().processingStatus).toBe('pending');
    expect(decision.calls).toHaveLength(0);
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
});
