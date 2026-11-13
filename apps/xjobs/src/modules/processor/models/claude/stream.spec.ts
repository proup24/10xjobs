import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, parseStream } from './stream';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', `${name}.jsonl`), 'utf8');

const ok = { code: 0, timedOut: false };

/** Re-serialise a fixture with one line of the given type edited. */
function edit(
  name: string,
  type: string,
  fn: (line: Record<string, any>) => void,
): string {
  return fixture(name)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const o = JSON.parse(l);
      if (o.type === type) fn(o);
      return JSON.stringify(o);
    })
    .join('\n');
}

describe('parseStream and classify', () => {
  it('reads a success: output, usage, cost, model, session', () => {
    const parsed = parseStream(fixture('success'));
    expect(classify(parsed, ok)).toBeNull();
    const r = parsed.result!;
    expect(r.isError).toBe(false);
    expect(r.structuredOutput).toBeDefined();
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.usage.input).toBe(2);
    expect(r.usage.output).toBe(89);
    expect(r.usage.cachedInput).toBe(613);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.sessionId).toBeTruthy();
    expect(r.apiErrorStatus).toBeNull();
  });

  it('treats the isolation recording as a success', () => {
    expect(classify(parseStream(fixture('isolation')), ok)).toBeNull();
  });

  it('records both windows from a rate_limit_event', () => {
    const { limits } = parseStream(fixture('success'));
    expect(limits).toEqual([
      {
        kind: 'five_hour',
        status: 'allowed',
        utilization: expect.any(Number),
        resetsAt: expect.any(Date),
      },
      {
        kind: 'weekly',
        status: 'allowed',
        utilization: 0.44,
        resetsAt: new Date(1794956400 * 1000),
      },
    ]);
  });

  it('weekly-85 gives a weekly observation at 0.86', () => {
    const { limits } = parseStream(fixture('weekly-85'));
    const weekly = limits.find((l) => l.kind === 'weekly')!;
    expect(weekly.utilization).toBe(0.86);
    expect(weekly.status).toBe('allowed_warning');
    expect(classify(parseStream(fixture('weekly-85')), ok)).toBeNull();
  });

  it('reads every recorded rate_limit_event', () => {
    const { limits } = parseStream(fixture('rate-limit-events'));
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((l) => l.resetsAt instanceof Date)).toBe(true);
  });

  it('maps a top-level seven_day_sonnet event to weekly_sonnet', () => {
    const stdout = edit('success', 'rate_limit_event', (o) => {
      o.rate_limit_info = {
        status: 'allowed_warning',
        resetsAt: 1794956400,
        rateLimitType: 'seven_day_sonnet',
        utilization: 0.9,
      };
    });
    expect(parseStream(stdout).limits).toEqual([
      {
        kind: 'weekly_sonnet',
        status: 'allowed_warning',
        utilization: 0.9,
        resetsAt: new Date(1794956400 * 1000),
      },
    ]);
  });

  it('maps an unknown top-level rateLimitType to other, null utilization', () => {
    const stdout = edit('success', 'rate_limit_event', (o) => {
      o.rate_limit_info = {
        status: 'allowed',
        rateLimitType: 'overage',
      };
    });
    expect(parseStream(stdout).limits).toEqual([
      { kind: 'other', status: 'allowed', utilization: null, resetsAt: null },
    ]);
  });

  it('no-structured-output is an output failure', () => {
    const parsed = parseStream(fixture('no-structured-output'));
    expect(parsed.result!.isError).toBe(true);
    expect(parsed.result!.model).toBe('claude-sonnet-5-5');
    expect(parsed.result!.errorText).toContain('maximum number of turns');
    expect(classify(parsed, ok)?.kind).toBe('output');
  });

  it('schema-mismatch is an output failure', () => {
    expect(classify(parseStream(fixture('schema-mismatch')), ok)?.kind).toBe(
      'output',
    );
  });

  it('a denied StructuredOutput is an output failure', () => {
    expect(
      classify(
        parseStream(fixture('disallowed-tools-denies-structured-output')),
        ok,
      )?.kind,
    ).toBe('output');
  });

  it('a success line without structured_output is an output failure', () => {
    const stdout = edit('success', 'result', (o) => {
      delete o.structured_output;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('output');
  });

  it('auth-failure is auth, with the init model', () => {
    const parsed = parseStream(fixture('auth-failure'));
    expect(parsed.result!.apiErrorStatus).toBe(401);
    expect(parsed.result!.model).toBe('claude-sonnet-5-5');
    expect(parsed.result!.errorText).toContain('401');
    expect(classify(parsed, { code: 1, timedOut: false })).toEqual({
      kind: 'auth',
    });
  });

  it('usage-limit carries the rejected observation with resetsAt', () => {
    const parsed = parseStream(fixture('usage-limit'));
    expect(classify(parsed, { code: 1, timedOut: false })).toEqual({
      kind: 'usage_limit',
      limit: {
        kind: 'five_hour',
        status: 'rejected',
        utilization: null,
        resetsAt: new Date(1794553200 * 1000),
      },
    });
  });

  it('usage-limit falls back to the rejected rate_limit_event', () => {
    const stdout = edit('usage-limit', 'assistant', (o) => {
      delete o.api_error_params;
    });
    const failure = classify(parseStream(stdout), ok);
    expect(failure).toMatchObject({
      kind: 'usage_limit',
      limit: { status: 'rejected', resetsAt: new Date(1794553200 * 1000) },
    });
  });

  it('usage-limit with no observation at all has a null limit', () => {
    const stdout = edit('usage-limit', 'assistant', (o) => {
      delete o.api_error_params;
    })
      .split('\n')
      .filter((l) => JSON.parse(l).type !== 'rate_limit_event')
      .join('\n');
    expect(classify(parseStream(stdout), ok)).toEqual({
      kind: 'usage_limit',
      limit: null,
    });
  });

  it('a 429 without usage_limit_reached is transient', () => {
    const stdout = edit('usage-limit', 'assistant', (o) => {
      delete o.api_error;
      delete o.api_error_params;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('transient');
  });

  it('usage_limit_reached is a usage limit even without a 429', () => {
    for (const status of [undefined, 500]) {
      const stdout = edit('usage-limit', 'result', (o) => {
        if (status === undefined) delete o.api_error_status;
        else o.api_error_status = status;
      });
      expect(classify(parseStream(stdout), ok)).toMatchObject({
        kind: 'usage_limit',
        limit: { kind: 'five_hour', status: 'rejected' },
      });
    }
  });

  it('a status-less api_error (connection error) is transient', () => {
    const stdout = fixture('auth-failure')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const o = JSON.parse(l);
        delete o.error;
        delete o.error_status;
        delete o.api_error_status;
        if (o.type === 'result') o.result = 'Connection error.';
        return JSON.stringify(o);
      })
      .join('\n');
    const parsed = parseStream(stdout);
    expect(parsed.authSignal).toBe(false);
    expect(parsed.result!.apiErrorStatus).toBeNull();
    expect(parsed.result!.terminalReason).toBe('api_error');
    expect(classify(parsed, { code: 1, timedOut: false })).toEqual({
      kind: 'transient',
      reason: 'Connection error.',
    });
  });

  it('an unknown is_error result with no status is transient', () => {
    const stdout = edit('auth-failure', 'result', (o) => {
      delete o.api_error_status;
      delete o.terminal_reason;
      o.result = 'Request timed out.';
    })
      .split('\n')
      .filter((l) => JSON.parse(l).type === 'result')
      .join('\n');
    expect(classify(parseStream(stdout), ok)?.kind).toBe('transient');
  });

  it('max_turns is an output failure even without errors text', () => {
    const stdout = edit('no-structured-output', 'result', (o) => {
      delete o.errors;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('output');
  });

  it('529 is transient', () => {
    const stdout = edit('auth-failure', 'result', (o) => {
      o.api_error_status = 529;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('transient');
  });

  it('5xx is transient', () => {
    const stdout = edit('auth-failure', 'result', (o) => {
      o.api_error_status = 503;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('transient');
  });

  it('other 4xx is a request failure', () => {
    const stdout = edit('auth-failure', 'result', (o) => {
      o.api_error_status = 400;
    });
    expect(classify(parseStream(stdout), ok)?.kind).toBe('request');
  });

  it('a timeout is transient', () => {
    expect(
      classify(parseStream(''), { code: null, timedOut: true })?.kind,
    ).toBe('transient');
  });

  it('a non-zero exit with no result line is transient', () => {
    expect(
      classify(parseStream('garbage\n'), { code: 2, timedOut: false })?.kind,
    ).toBe('transient');
  });

  it('a clean exit with no result line is transient', () => {
    expect(classify(parseStream(''), ok)?.kind).toBe('transient');
  });

  it('skips non-JSON lines without throwing', () => {
    const stdout = `warning: not json\n${fixture('success')}\n{broken`;
    const parsed = parseStream(stdout);
    expect(parsed.result).not.toBeNull();
    expect(classify(parsed, ok)).toBeNull();
  });
});
