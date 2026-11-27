import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maxTurnsReason, parseTurns, turnsSummary } from './turns';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', `${name}.jsonl`), 'utf8');

const assistant = (id: string, content: unknown[], model = 'claude-x') =>
  JSON.stringify({
    type: 'assistant',
    message: { id, model, role: 'assistant', content },
  });
const toolUse = { type: 'tool_use', name: 'StructuredOutput', input: {} };
const text = (t: string) => ({ type: 'text', text: t });
const toolResult = (content: unknown, isError: boolean) =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content,
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  });
const nudge = JSON.stringify({
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'text',
        text: '[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.',
      },
    ],
  },
  isSynthetic: true,
});
const result = (subtype: string, numTurns: number) =>
  JSON.stringify({ type: 'result', subtype, num_turns: numTurns });

describe('parseTurns', () => {
  it('reads a one-request success', () => {
    expect(parseTurns(fixture('success'))).toEqual({
      numTurns: 2,
      subtype: 'success',
      requests: 1,
      textReplies: 0,
      enforceNudges: 0,
      toolCalls: 1,
      rejections: [],
    });
  });

  it('reads a schema rejection: one request (thinking and tool_use lines share an id)', () => {
    expect(parseTurns(fixture('schema-mismatch'))).toEqual({
      numTurns: 2,
      subtype: 'error_max_turns',
      requests: 1,
      textReplies: 0,
      enforceNudges: 0,
      toolCalls: 1,
      rejections: [
        'Output does not match required schema: /code: must NOT have fewer than 5 characters (got 2)',
      ],
    });
  });

  it('reads a text-only reply and the enforce nudge', () => {
    expect(parseTurns(fixture('no-structured-output'))).toEqual({
      numTurns: 2,
      subtype: 'error_max_turns',
      requests: 1,
      textReplies: 1,
      enforceNudges: 1,
      toolCalls: 0,
      rejections: [],
    });
  });

  it('a request with text and a StructuredOutput call is not a text reply', () => {
    expect(parseTurns(fixture('isolation'))).toMatchObject({
      requests: 1,
      textReplies: 0,
      toolCalls: 1,
      subtype: 'success',
    });
  });

  it('does not count a synthetic assistant message as a request', () => {
    expect(parseTurns(fixture('usage-limit'))).toMatchObject({
      requests: 0,
      textReplies: 0,
    });
  });

  it('counts three requests, clips each rejection to 300 characters and keeps the last 3', () => {
    const long = `Output does not match required schema: /a: ${'x'.repeat(400)}`;
    const stdout = [
      assistant('m1', [text('{"title": "x"}')]),
      nudge,
      assistant('m2', [toolUse]),
      toolResult('first', true),
      assistant('m3', [toolUse]),
      toolResult([{ type: 'text', text: long }], true),
      toolResult('second', true),
      toolResult('third', true),
      result('error_max_turns', 4),
    ].join('\n');
    const turns = parseTurns(stdout);
    expect(turns).toMatchObject({
      numTurns: 4,
      subtype: 'error_max_turns',
      requests: 3,
      textReplies: 1,
      enforceNudges: 1,
      toolCalls: 2,
    });
    expect(turns.rejections).toHaveLength(3);
    expect(turns.rejections[0]).toHaveLength(301);
    expect(turns.rejections[0]!.endsWith('…')).toBe(true);
    expect(turns.rejections.slice(1)).toEqual(['second', 'third']);
  });

  it('tolerates garbage lines and a missing result', () => {
    expect(parseTurns('not json\n\n{"type":"assistant"}\n')).toEqual({
      numTurns: null,
      subtype: null,
      requests: 1,
      textReplies: 0,
      enforceNudges: 0,
      toolCalls: 0,
      rejections: [],
    });
  });
});

describe('turnsSummary and maxTurnsReason', () => {
  const base = {
    numTurns: 4,
    subtype: 'error_max_turns',
    requests: 3,
    textReplies: 1,
    enforceNudges: 1,
    toolCalls: 2,
    rejections: [] as string[],
  };

  it('summarises a call for the log line', () => {
    expect(turnsSummary({ ...base, rejections: ['a', 'b'] })).toBe(
      'requests 3 · text 1 · nudges 1 · rejected 2',
    );
  });

  it('names the last rejection, or the missing StructuredOutput call', () => {
    expect(
      maxTurnsReason({ ...base, requests: 1, toolCalls: 0, textReplies: 1 }),
    ).toBe('max turns: no StructuredOutput call in 1 request');
    expect(maxTurnsReason({ ...base, rejections: ['a', 'b'] })).toBe(
      'max turns after 3 requests; last rejection: b',
    );
    expect(maxTurnsReason({ ...base, toolCalls: 0, textReplies: 3 })).toBe(
      'max turns: no StructuredOutput call in 3 requests',
    );
    expect(maxTurnsReason({ ...base })).toBeNull();
  });
});
