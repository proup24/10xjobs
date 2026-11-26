import { describe, expect, it } from 'vitest';
import { parseCallbackBody } from './body';

const JOB = '3f2b8a52-6c1d-4d0e-9a57-0b1e3f4c5d6e';
const parse = (v: unknown) => parseCallbackBody(Buffer.from(JSON.stringify(v)));

describe('parseCallbackBody', () => {
  it('parses ping', () => {
    expect(parse({ version: 1, type: 'ping' })).toEqual({ type: 'ping' });
  });
  it('parses applied', () => {
    expect(
      parse({ version: 1, type: 'feedback', jobId: JOB, status: 'applied' }),
    ).toEqual({
      type: 'feedback',
      feedback: { jobId: JOB, status: 'applied' },
    });
  });
  it('parses dismissed with reason and note', () => {
    expect(
      parse({
        version: 1,
        type: 'feedback',
        jobId: JOB,
        status: 'dismissed',
        reason: 'location',
        note: '  too far  ',
      }),
    ).toEqual({
      type: 'feedback',
      feedback: {
        jobId: JOB,
        status: 'dismissed',
        reason: 'location',
        note: 'too far',
      },
    });
  });
  it.each([
    ['not JSON', Buffer.from('nope')],
    ['version 2', Buffer.from(JSON.stringify({ version: 2, type: 'ping' }))],
    [
      'reason on applied',
      Buffer.from(
        JSON.stringify({
          version: 1,
          type: 'feedback',
          jobId: JOB,
          status: 'applied',
          reason: 'location',
        }),
      ),
    ],
    [
      'unknown reason',
      Buffer.from(
        JSON.stringify({
          version: 1,
          type: 'feedback',
          jobId: JOB,
          status: 'dismissed',
          reason: 'because',
        }),
      ),
    ],
    [
      'note over 500',
      Buffer.from(
        JSON.stringify({
          version: 1,
          type: 'feedback',
          jobId: JOB,
          status: 'dismissed',
          note: 'x'.repeat(501),
        }),
      ),
    ],
    [
      'job id not a uuid',
      Buffer.from(
        JSON.stringify({
          version: 1,
          type: 'feedback',
          jobId: 'abc',
          status: 'applied',
        }),
      ),
    ],
  ])('invalid: %s', (_name, raw) => {
    expect(parseCallbackBody(raw).type).toBe('invalid');
  });
});
