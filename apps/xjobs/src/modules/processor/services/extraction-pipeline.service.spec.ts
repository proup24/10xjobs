import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import { ProviderUnavailableError } from '../models/errors';
import type { PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { needsReview } from '../rules/validate';
import { FakeExtractionModel, MemoryVocabRepository } from '../testing/fakes';
import { DESCRIPTION, generatorOutput, mf } from '../testing/generator-output';
import { AttemptLog } from './attempt-log';
import {
  ExtractionFailed,
  ExtractionPipeline,
} from './extraction-pipeline.service';
import { FactAssembler } from './fact-assembler.service';
import { GenerationService } from './generation.service';

const EXT = 'anthropic/claude-opus-5.5';

const baseConfig: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
};

const input: PostingInput = {
  jobId: 'job-1',
  title: 'Senior Backend Engineer',
  description: DESCRIPTION,
  truncated: false,
};

describe('ExtractionPipeline', () => {
  let vocabulary: Vocabulary;
  let log: AttemptLog;
  let extraction: FakeExtractionModel;

  const pipeline = (config: ProcessorConfig = baseConfig) =>
    new ExtractionPipeline(
      new GenerationService(extraction, new FactAssembler(), config),
    );
  const run = (config?: ProcessorConfig) =>
    pipeline(config).run(input, vocabulary, log);
  const steps = () => log.entries().map((e) => [e.step, e.outcome]);

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vocabulary = await new MemoryVocabRepository().snapshot();
    log = new AttemptLog('job-1');
    extraction = new FakeExtractionModel(() => generatorOutput(), EXT);
  });
  afterEach(() => vi.restoreAllMocks());

  it('makes one generation and no verification call', async () => {
    const { doc } = await run();

    expect(extraction.calls).toHaveLength(1);
    expect(extraction.calls[0].req.retryErrors).toBeUndefined();
    expect(steps()).toEqual([['generation', 'ok']]);
    expect(doc.models).toEqual({ generator: EXT });
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      confidence: 'sure',
    });
    expect(needsReview(doc)).toBe(false);
  });

  it('retries a schema failure with its errors, then fails', async () => {
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
    expect(extraction.calls[0].req.retryErrors).toBeUndefined();
    expect(extraction.calls[1].req.retryErrors?.join('\n')).toContain(
      'seniority.value',
    );
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
  });

  it('schema fails twice then passes: generation, generation_retry x2', async () => {
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
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'ok'],
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
    ]);
  });

  it('a provider failure propagates and is logged', async () => {
    extraction = new FakeExtractionModel(() => {
      throw new ProviderUnavailableError('402 payment required');
    }, EXT);

    await expect(run()).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(extraction.calls).toHaveLength(1);
  });

  it('roleKind and isSoftwareEngineeringRole inconsistent: both unsure, needsReview', async () => {
    extraction = new FakeExtractionModel(
      () =>
        generatorOutput({
          position: mf(
            { roleKind: 'support', title: 'Backend Engineer' },
            'Senior Backend Engineer',
          ),
        }),
      EXT,
    );

    const { doc } = await run();

    expect(extraction.calls).toHaveLength(1);
    expect(doc.position.confidence).toBe('unsure');
    expect(doc.isSoftwareEngineeringRole.confidence).toBe('unsure');
    expect(needsReview(doc)).toBe(true);
  });

  it('carries the input truncated flag onto the document', async () => {
    const truncated = await pipeline().run(
      { ...input, truncated: true },
      vocabulary,
      log,
    );
    const whole = await run();

    expect(truncated.doc.truncated).toBe(true);
    expect(whole.doc.truncated).toBe(false);
  });
});
