import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import { postSystemPrompt } from '../prompts/prompt';
import type { Vocabulary } from '../repositories/vocab.repository';
import type { PostInput } from '../rules/post-input';
import type { PostModelOutput } from '../schema/post-extraction';
import { FakeExtractionModel, MemoryVocabRepository } from '../testing/fakes';
import { DESCRIPTION, generatorOutput, mf } from '../testing/generator-output';
import { AttemptLog } from './attempt-log';
import { ExtractionFailed } from './extraction-pipeline.service';
import { FactAssembler } from './fact-assembler.service';
import { GenerationService } from './generation.service';
import { PostAssembler } from './post-assembler.service';
import { PostPipeline } from './post-pipeline.service';

const EXT = 'anthropic/claude-opus-5.5';

const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
};

const POST_TEXT = `We are hiring. Acme is hiring. Send your CV to jobs@acme.com. ${DESCRIPTION}`;
const post: PostInput = {
  input: {
    jobId: 'job-1',
    title: null,
    description: `${POST_TEXT}\n\nLinks in the post:\njobs@acme.com\npress@acme.com`,
    truncated: false,
  },
  postText: POST_TEXT,
  links: { emails: ['jobs@acme.com'], linkedinJobIds: [], urls: [] },
};

type Role = PostModelOutput['roles'][number];

function output(
  email = 'jobs@acme.com',
  patch: Record<string, unknown> = {},
): PostModelOutput {
  const base = generatorOutput(patch) as unknown as Role;
  return {
    verdict: {
      value: 'hiring',
      reason: 'hiring',
      quote: 'We are hiring',
      confidence: 'sure',
    },
    roles: [
      {
        ...base,
        employer: { name: 'Acme', quote: 'Acme is hiring' },
        authorRelation: 'employer',
        howToApply: {
          kinds: ['email'],
          email,
          emailQuote: `Send your CV to ${email}`,
          links: [],
          quote: 'Send your CV',
        },
      } as Role,
    ],
  };
}

describe('PostPipeline', () => {
  let vocabulary: Vocabulary;
  let log: AttemptLog;
  let model: FakeExtractionModel;

  const run = () =>
    new PostPipeline(
      new GenerationService(model, new FactAssembler(), config),
      new PostAssembler(new FactAssembler()),
    ).run(post, vocabulary, log);
  const steps = () => log.entries().map((e) => [e.step, e.outcome]);

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vocabulary = await new MemoryVocabRepository().snapshot();
    log = new AttemptLog('job-1', { docType: 'post' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the post prompt and returns the assembled post', async () => {
    model = new FakeExtractionModel(() => output(), EXT);

    const assembled = await run();

    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].req.systemPrompt).toBe(postSystemPrompt());
    expect(model.calls[0].input).toBe(post.input);
    expect(assembled.doc.roles).toHaveLength(1);
    expect(assembled.doc.roles[0].howToApply.email).toBe('jobs@acme.com');
    expect(steps()).toEqual([['generation', 'ok']]);
  });

  it('retries an invalid email once with the assembler error, then succeeds', async () => {
    let n = 0;
    model = new FakeExtractionModel(
      () => (n++ === 0 ? output('press@acme.com') : output()),
      EXT,
    );

    const assembled = await run();

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].req.retryErrors).toEqual([
      'roles.0.howToApply.email: not an email found in the post',
    ]);
    expect(steps()).toEqual([
      ['generation', 'invalid'],
      ['generation_retry', 'ok'],
    ]);
    expect(assembled.doc.roles[0].howToApply.email).toBe('jobs@acme.com');
  });

  it('writes the post doc type on every attempt', async () => {
    let n = 0;
    model = new FakeExtractionModel(
      () => (n++ === 0 ? output('press@acme.com') : output()),
      EXT,
    );

    await run();

    expect(log.entries().map((e) => e.docType)).toEqual(['post', 'post']);
  });

  it('runs the consistency rules on each role', async () => {
    model = new FakeExtractionModel(
      () =>
        output('jobs@acme.com', {
          isSoftwareEngineeringRole: mf(false, 'Backend Engineer'),
        }),
      EXT,
    );

    const assembled = await run();

    expect(assembled.doc.roles[0].facts.position.confidence).toBe('unsure');
    expect(
      assembled.doc.roles[0].facts.isSoftwareEngineeringRole.confidence,
    ).toBe('unsure');
    expect(assembled.roles[0].doc.position.confidence).toBe('unsure');
  });

  it('throws ExtractionFailed when every try is invalid', async () => {
    model = new FakeExtractionModel(() => output('press@acme.com'), EXT);

    const error = await run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExtractionFailed);
    expect((error as ExtractionFailed).errors).toEqual([
      'roles.0.howToApply.email: not an email found in the post',
    ]);
    expect(model.calls).toHaveLength(3);
  });
});
