import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import { ModelOutputError, ProviderUnavailableError } from '../models/errors';
import type {
  DecisionAnswer,
  DecisionQuestion,
  PostingInput,
} from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { needsReview } from '../rules/validate';
import { FakeDecisionModel, FakeExtractionModel } from '../testing/fakes';
import {
  DESCRIPTION,
  generatorOutput,
  jevAnswers,
  mf,
} from '../testing/generator-output';
import { MemoryVocabRepository } from '../testing/fakes';
import { AttemptLog } from './attempt-log';
import {
  ExtractionFailed,
  ExtractionPipeline,
} from './extraction-pipeline.service';
import { FactAssembler } from './fact-assembler.service';
import { GenerationService } from './generation.service';
import { VerificationService } from './verification.service';

const DEC = 'typesafe/jev-1.14';
const EXT = 'anthropic/claude-opus-5.5';

const baseConfig: ProcessorConfig = {
  decisionModel: DEC,
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  maxRegenerations: 2,
  generationTries: 3,
};

const input: PostingInput = {
  jobId: 'job-1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: DESCRIPTION,
  truncated: false,
  evidence: {
    location: null,
    contractType: null,
    experienceLevel: null,
    salary: null,
  },
};

type Responder = (
  input: PostingInput,
  questions: DecisionQuestion[],
) => DecisionAnswer[];

/** Each Jev call answers with the next responder; the last one repeats. */
const rounds =
  (...responders: Responder[]): Responder =>
  (i, q) => {
    const next = responders.length > 1 ? responders.shift() : responders[0];
    return (next as Responder)(i, q);
  };

describe('ExtractionPipeline', () => {
  let vocabulary: Vocabulary;
  let log: AttemptLog;
  let extraction: FakeExtractionModel;
  let decision: FakeDecisionModel;

  const pipeline = (config: ProcessorConfig = baseConfig) =>
    new ExtractionPipeline(
      new GenerationService(extraction, new FactAssembler(), config),
      new VerificationService(decision, config),
      config,
    );
  const run = (config?: ProcessorConfig) =>
    pipeline(config).run(input, vocabulary, log);
  const steps = () => log.entries().map((e) => [e.step, e.outcome]);
  const asked = (call: number) =>
    decision.calls[call].questions.map((q) => q.key).sort();

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vocabulary = await new MemoryVocabRepository().snapshot();
    log = new AttemptLog('job-1');
    extraction = new FakeExtractionModel(() => generatorOutput(), EXT);
    decision = new FakeDecisionModel(jevAnswers(), DEC);
  });
  afterEach(() => vi.restoreAllMocks());

  it('confirmed first time: 1 generation, 1 verification, rounds 1', async () => {
    const { doc } = await run();

    expect(extraction.calls).toHaveLength(1);
    expect(extraction.calls[0].req.feedback).toBeUndefined();
    expect(decision.calls).toHaveLength(1);
    expect(asked(0)).toContain('seniority');
    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'ok'],
    ]);
    expect(doc.verification).toMatchObject({
      rounds: 1,
      dropped: [],
      regenerationInvalid: false,
    });
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      confidence: 'sure',
      score: 0.95,
      verification: { verdict: 'confirmed', jevPick: 'senior', rounds: 1 },
    });
    expect(doc.models).toEqual({ verifier: DEC, generator: EXT });
    expect(needsReview(doc)).toBe(false);
  });

  it('rejected then fixed: feedback for seniority only; round 2 asks seniority and the changed fields', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      () =>
        n++ === 0
          ? generatorOutput()
          : generatorOutput({
              seniority: mf('mid', 'Senior'),
              engagement: mf('contractor', ''),
            }),
      EXT,
    );
    decision = new FakeDecisionModel(
      rounds(
        jevAnswers({ seniority: { value: 'mid' } }),
        jevAnswers({
          seniority: { value: 'mid' },
          engagement: { value: 'contractor' },
        }),
      ),
      DEC,
    );

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(2);
    expect(extraction.calls[1].req.feedback).toEqual([
      {
        key: 'seniority',
        verdict: 'rejected',
        score: 0.95,
        jevPick: 'mid',
        generatorValue: 'senior',
      },
    ]);
    expect(decision.calls).toHaveLength(2);
    expect(asked(1)).toEqual(['engagement', 'seniority']);
    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'ok'],
      ['generation', 'ok'],
      ['verification', 'ok'],
    ]);
    expect(doc.seniority).toMatchObject({
      value: 'mid',
      confidence: 'sure',
      verification: { verdict: 'confirmed', rounds: 2 },
    });
    expect(doc.engagement.value).toBe('contractor');
    // A confirmed, unchanged field keeps its round-1 verdict.
    expect(doc.arrangement.verification).toMatchObject({
      verdict: 'confirmed',
    });
    expect(doc.verification).toMatchObject({ rounds: 2, dropped: [] });
  });

  it('rejected twice → dropped: 3 generations, 3 verifications, needsReview', async () => {
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid' } }),
      DEC,
    );

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(3);
    expect(decision.calls).toHaveLength(3);
    expect(asked(1)).toEqual(['seniority']);
    expect(asked(2)).toEqual(['seniority']);
    expect(doc.verification.rounds).toBe(3);
    expect(doc.verification.dropped).toEqual([
      { field: 'seniority', generatorValue: 'senior', jevPick: 'mid' },
    ]);
    expect(doc.seniority).toMatchObject({
      value: 'unstated',
      quote: '',
      confidence: 'unsure',
    });
    expect(needsReview(doc)).toBe(true);
  });

  it('unconfirmed only → no regeneration', async () => {
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid', score: 0.4 } }),
      DEC,
    );

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(1);
    expect(decision.calls).toHaveLength(1);
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      confidence: 'unsure',
      score: 0.4,
      verification: { verdict: 'unconfirmed', jevPick: 'mid' },
    });
    expect(doc.verification.dropped).toEqual([]);
  });

  it('schema fails twice then passes: generation, generation_retry ×2, verification', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      () =>
        n++ < 2
          ? generatorOutput({ seniority: mf('wizard') })
          : generatorOutput(),
      EXT,
    );

    await run();

    expect(extraction.calls).toHaveLength(3);
    expect(extraction.calls[0].req.retryErrors).toBeUndefined();
    expect(extraction.calls[1].req.retryErrors?.join('\n')).toContain(
      'seniority.value',
    );
    expect(extraction.calls[2].req.retryErrors?.join('\n')).toContain(
      'seniority.value',
    );
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'ok'],
      ['verification', 'ok'],
    ]);
  });

  it('an assembler error counts as a failed try', async () => {
    let n = 0;
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
    extraction = new FakeExtractionModel(
      () => generatorOutput(n++ === 0 ? badStrictness : {}),
      EXT,
    );

    await run();

    expect(extraction.calls[1].req.retryErrors?.join('\n')).toContain(
      'openings.0.placeStrictness',
    );
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
      ['verification', 'ok'],
    ]);
  });

  it('first generation fails all tries → ExtractionFailed', async () => {
    extraction = new FakeExtractionModel(
      () => generatorOutput({ seniority: mf('wizard') }),
      EXT,
    );

    const error = await run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExtractionFailed);
    expect((error as ExtractionFailed).errors.join('\n')).toContain(
      'seniority.value',
    );
    expect(extraction.calls).toHaveLength(3);
    expect(decision.calls).toHaveLength(0);
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
  });

  it('regeneration fails all tries → previous document finalized, regenerationInvalid true', async () => {
    let n = 0;
    extraction = new FakeExtractionModel(
      () =>
        n++ === 0
          ? generatorOutput()
          : generatorOutput({ seniority: mf('wizard') }),
      EXT,
    );
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid' } }),
      DEC,
    );

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(4);
    expect(decision.calls).toHaveLength(1);
    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'ok'],
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
    // Two generation rounds were spent: the first, and the invalid regeneration.
    expect(doc.verification).toMatchObject({
      rounds: 2,
      regenerationInvalid: true,
      dropped: [
        { field: 'seniority', generatorValue: 'senior', jevPick: 'mid' },
      ],
    });
    expect(doc.seniority.value).toBe('unstated');
    expect(needsReview(doc)).toBe(true);
  });

  it('Jev invalid output → every field unconfirmed, logged invalid, no regeneration', async () => {
    decision = new FakeDecisionModel(() => {
      throw new ModelOutputError('Decisions API returned no answers', {
        costUsd: 0.002,
      });
    }, DEC);

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(1);
    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'invalid'],
    ]);
    expect(log.entries()[1].costUsd).toBe(0.002);
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      confidence: 'unsure',
      verification: { verdict: 'unconfirmed', jevPick: null },
    });
    expect(doc.arrangement.verification?.verdict).toBe('unconfirmed');
  });

  it('Jev missing an answer → that field unconfirmed, logged invalid', async () => {
    decision = new FakeDecisionModel(
      (i, q) => jevAnswers()(i, q).filter((a) => a.key !== 'seniority'),
      DEC,
    );

    const { doc } = await run();

    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'invalid'],
    ]);
    expect(doc.seniority.verification?.verdict).toBe('unconfirmed');
    expect(doc.arrangement.verification?.verdict).toBe('confirmed');
  });

  it('Jev 402 → ProviderUnavailableError propagates', async () => {
    decision = new FakeDecisionModel(() => {
      throw new ProviderUnavailableError('OpenRouter returned 402');
    }, DEC);

    await expect(run()).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(steps()).toEqual([
      ['generation', 'ok'],
      ['verification', 'error'],
    ]);
  });

  it('maxRegenerations 0 → one round, rejected fields dropped', async () => {
    decision = new FakeDecisionModel(
      jevAnswers({ seniority: { value: 'mid' } }),
      DEC,
    );

    const { doc } = await run({ ...baseConfig, maxRegenerations: 0 });

    expect(extraction.calls).toHaveLength(1);
    expect(decision.calls).toHaveLength(1);
    expect(doc.verification.rounds).toBe(1);
    expect(doc.verification.dropped.map((d) => d.field)).toEqual(['seniority']);
    expect(doc.seniority.value).toBe('unstated');
  });
});
