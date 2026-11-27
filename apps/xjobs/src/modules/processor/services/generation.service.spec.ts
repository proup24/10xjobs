import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ProcessorConfig } from '../config/processor.config';
import { ExtractionInvalidError, ModelOutputError } from '../models/errors';
import type { PostingInput } from '../models/types';
import { systemPrompt } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import {
  FakeExtractionModel,
  MemoryVocabRepository,
  sequence,
} from '../testing/fakes';
import { DESCRIPTION, generatorOutput } from '../testing/generator-output';
import { AttemptLog } from './attempt-log';
import { FactAssembler } from './fact-assembler.service';
import { type GenerationSpec, GenerationService } from './generation.service';

const EXT = 'anthropic/claude-opus-5.5';

const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
  postDailyCap: 250,
};

const input: PostingInput = {
  jobId: 'job-1',
  title: null,
  description: DESCRIPTION,
  truncated: false,
};

type Echo = { word: string; quoteFailures: number };

/** A spec with its own prompt and schema; `assemble` rejects every word but "ok". */
const echoSpec: GenerationSpec<Echo> = {
  systemPrompt: () => 'ECHO PROMPT',
  schema: () => z.strictObject({ word: z.string() }),
  assemble: (parsed) => {
    const { word } = parsed as { word: string };
    if (word !== 'ok')
      throw new ExtractionInvalidError('word', `word: ${word} is not ok`);
    return { word, quoteFailures: 2 };
  },
};

describe('GenerationService', () => {
  let vocabulary: Vocabulary;
  let log: AttemptLog;

  const service = (model: FakeExtractionModel) =>
    new GenerationService(model, new FactAssembler(), config);
  const steps = () => log.entries().map((e) => [e.step, e.outcome]);

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vocabulary = await new MemoryVocabRepository().snapshot();
    log = new AttemptLog('job-1');
  });
  afterEach(() => vi.restoreAllMocks());

  it('generate sends the listing prompt and schema', async () => {
    const model = new FakeExtractionModel(() => generatorOutput(), EXT);

    const result = await service(model).generate(input, vocabulary, log);

    expect(result.ok).toBe(true);
    expect(model.calls[0].req.systemPrompt).toBe(systemPrompt());
    expect(steps()).toEqual([['generation', 'ok']]);
  });

  it("generateWith sends the spec's prompt and schema and returns its assembly", async () => {
    const model = new FakeExtractionModel(() => ({ word: 'ok' }), EXT);

    const result = await service(model).generateWith(
      echoSpec,
      input,
      vocabulary,
      log,
    );

    expect(result).toEqual({
      ok: true,
      assembled: { word: 'ok', quoteFailures: 2 },
    });
    expect(model.calls[0].req.systemPrompt).toBe('ECHO PROMPT');
    expect(model.calls[0].req.schema.safeParse({ word: 'x' }).success).toBe(
      true,
    );
    expect(log.entries()[0].quoteFailures).toBe(2);
  });

  it('retries a max-turns end with its last rejection, not the turn-limit message', async () => {
    const model = new FakeExtractionModel(
      sequence<unknown>(
        new ModelOutputError(
          'max turns after 3 requests; last rejection: /word: must be string',
          undefined,
          ['/word: must be string'],
        ),
        { word: 'ok' },
      ),
      EXT,
    );

    const result = await service(model).generateWith(
      echoSpec,
      input,
      vocabulary,
      log,
    );

    expect(result.ok).toBe(true);
    expect(model.calls[1].req.retryErrors).toEqual(['/word: must be string']);
    expect(log.entries()[0].error).toBe(
      'max turns after 3 requests; last rejection: /word: must be string',
    );
  });

  it('retries a max-turns end with no rejection without error feedback', async () => {
    const model = new FakeExtractionModel(
      sequence<unknown>(
        new ModelOutputError(
          'max turns: no StructuredOutput call in 3 requests',
          undefined,
          [],
        ),
        { word: 'ok' },
      ),
      EXT,
    );

    const result = await service(model).generateWith(
      echoSpec,
      input,
      vocabulary,
      log,
    );

    expect(result.ok).toBe(true);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].req.retryErrors).toBeUndefined();
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
    ]);
  });

  it('a generation that runs out of turns on every try fails with the message', async () => {
    const model = new FakeExtractionModel(
      sequence<unknown>(
        new ModelOutputError(
          'max turns: no StructuredOutput call in 3 requests',
          undefined,
          [],
        ),
      ),
      EXT,
    );

    const result = await service(model).generateWith(
      echoSpec,
      input,
      vocabulary,
      log,
    );

    expect(result).toEqual({
      ok: false,
      errors: ['max turns: no StructuredOutput call in 3 requests'],
    });
    expect(model.calls.map((c) => c.req.retryErrors)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("retries the spec's assembler error with its message, then fails", async () => {
    const model = new FakeExtractionModel(() => ({ word: 'bad' }), EXT);

    const result = await service(model).generateWith(
      echoSpec,
      input,
      vocabulary,
      log,
    );

    expect(result).toEqual({ ok: false, errors: ['word: bad is not ok'] });
    expect(model.calls).toHaveLength(3);
    expect(model.calls[1].req.retryErrors).toEqual(['word: bad is not ok']);
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'invalid'],
      ['generation_retry', 'invalid'],
    ]);
  });
});
