import { Logger } from '@nestjs/common';
import { TransientModelError } from '../models/errors';
import { AttemptLog } from './attempt-log';

const JOB = '01a19b93-fcc0-7174-8021-7e0c20680efb';
const meta = {
  model: 'deepseek/deepseek-v4.1-flash-1017',
  providerRequestId: 'gen-1',
  inputTokens: 1200,
  outputTokens: 300,
  cachedInputTokens: 0,
  costUsd: 0.0123,
  latencyMs: 3450,
};

describe('AttemptLog', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    debug = vi
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs a call before it starts, so a long call shows what is in flight', () => {
    new AttemptLog(JOB).calling('extraction', meta.model, '18 KB posting');
    expect(log).toHaveBeenCalledWith(
      `[job ${JOB}] extraction → ${meta.model} (18 KB posting)`,
    );
  });

  it('logs a successful call with its time, tokens and cost', () => {
    new AttemptLog(JOB).ok('extraction', meta.model, meta);
    expect(log).toHaveBeenCalledWith(
      `[job ${JOB}] extraction ok in 3.5s · 1200 in / 300 out tokens · $0.012300`,
    );
  });

  it('warns on an invalid answer and on a failed call, with the reason', () => {
    const run = new AttemptLog(JOB);
    run.invalid('extraction', meta.model, meta, 'openings.0: required');
    run.failed(
      'extraction_retry',
      meta.model,
      new TransientModelError('OpenRouter call failed: terminated', {
        latencyMs: 120_000,
      }),
    );
    expect(warn).toHaveBeenNthCalledWith(
      1,
      `[job ${JOB}] extraction invalid in 3.5s · $0.012300: openings.0: required`,
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      `[job ${JOB}] extraction_retry failed after 120.0s: OpenRouter call failed: terminated`,
    );
  });

  it('labels a preview run, and logs details at debug', () => {
    const run = new AttemptLog(null);
    run.debug('fallback to the extraction model: seniority');
    expect(debug).toHaveBeenCalledWith(
      '[preview] fallback to the extraction model: seniority',
    );
  });

  it('clips a very long reason', () => {
    new AttemptLog(JOB).invalid(
      'extraction',
      meta.model,
      meta,
      'x'.repeat(2000),
    );
    const line = warn.mock.calls[0]![0] as string;
    expect(line.length).toBeLessThan(700);
  });
});
