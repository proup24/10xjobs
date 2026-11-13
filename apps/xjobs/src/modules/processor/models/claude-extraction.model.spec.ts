import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type {
  ClaudeCall,
  ClaudeRunResult,
  ClaudeRunner,
} from './claude/runner';
import type { LimitObservation } from './claude/stream';
import { ClaudeExtractionModel } from './claude-extraction.model';
import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from './errors';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'claude', 'fixtures', `${name}.jsonl`), 'utf8');

const schema = z.object({ title: z.string(), remote: z.boolean() });
const input = {
  jobId: 'j1',
  title: 'Dev',
  description: 'Build.',
  truncated: false,
};

function setup(result: Partial<ClaudeRunResult> | Error) {
  const calls: ClaudeCall[] = [];
  const runner = {
    run: vi.fn(async (call: ClaudeCall) => {
      calls.push(call);
      if (result instanceof Error) throw result;
      return {
        stdout: '',
        stderr: '',
        code: 0,
        timedOut: false,
        latencyMs: 42,
        ...result,
      };
    }),
  } as unknown as ClaudeRunner;
  const onLimits = vi.fn<(o: LimitObservation[]) => void>();
  const model = new ClaudeExtractionModel(
    runner,
    'claude-sonnet-5-5',
    { effort: 'low', timeoutMs: 1000 },
    onLimits,
  );
  return { model, calls, onLimits };
}

const req = { systemPrompt: 'sys', schema };

describe('ClaudeExtractionModel', () => {
  it('returns the output and meta on success', async () => {
    const { model, calls, onLimits } = setup({ stdout: fixture('success') });
    const { output, meta } = await model.generate(input, req);
    expect(output).toEqual({
      title: 'Senior Backend Engineer (TypeScript)',
      remote: true,
    });
    expect(meta.model).toBe('claude-sonnet-5-5');
    expect(meta.latencyMs).toBe(42);
    expect(meta.providerRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.costUsd).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      systemPrompt: 'sys',
      effort: 'low',
      timeoutMs: 1000,
      userMessage: 'Title: Dev\n\nBuild.',
    });
    expect(calls[0].jsonSchema).toMatchObject({ type: 'object' });
    expect(onLimits).toHaveBeenCalledTimes(1);
  });

  it('adds the retry errors to the user message', async () => {
    const { model, calls } = setup({ stdout: fixture('success') });
    await model.generate(input, { ...req, retryErrors: ['a: bad'] });
    expect(calls[0].userMessage).toContain('Your previous answer was invalid');
    expect(calls[0].userMessage).toContain('- a: bad');
  });

  it('maps a usage limit and reports the limits', async () => {
    const { model, onLimits } = setup({
      stdout: fixture('usage-limit'),
      code: 1,
    });
    const error = await model.generate(input, req).catch((e) => e);
    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error.limit).not.toBeNull();
    expect(onLimits).toHaveBeenCalledTimes(1);
    expect(onLimits.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it('maps an auth failure to ProviderUnavailableError', async () => {
    const { model, onLimits } = setup({
      stdout: fixture('auth-failure'),
      code: 1,
    });
    await expect(model.generate(input, req)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(onLimits).toHaveBeenCalledTimes(1);
  });

  it('maps a timeout to TransientModelError and still reports limits', async () => {
    const { model, onLimits } = setup({
      stdout: '',
      code: null,
      timedOut: true,
    });
    await expect(model.generate(input, req)).rejects.toBeInstanceOf(
      TransientModelError,
    );
    expect(onLimits).toHaveBeenCalledWith([]);
  });

  it('maps a spawn failure to ProviderUnavailableError, without onLimits', async () => {
    const { model, onLimits } = setup(new Error('spawn claude ENOENT'));
    await expect(model.generate(input, req)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(onLimits).not.toHaveBeenCalled();
  });

  it('maps no structured output to ModelOutputError with meta', async () => {
    const { model } = setup({ stdout: fixture('no-structured-output') });
    const error = await model.generate(input, req).catch((e) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error.meta?.latencyMs).toBe(42);
  });

  it('maps a request error to ModelRequestError', async () => {
    const line = JSON.stringify({
      type: 'result',
      is_error: true,
      api_error_status: 400,
      result: 'bad request',
    });
    const { model } = setup({ stdout: line, code: 1 });
    await expect(model.generate(input, req)).rejects.toBeInstanceOf(
      ModelRequestError,
    );
  });

  it('re-validates with the schema and lists the issues', async () => {
    const strict = z.object({ title: z.string(), remote: z.string() });
    const { model } = setup({ stdout: fixture('success') });
    const error = await model
      .generate(input, { ...req, schema: strict })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error.message).toContain('remote');
    expect(error.meta?.model).toBe('claude-sonnet-5-5');
  });
});
