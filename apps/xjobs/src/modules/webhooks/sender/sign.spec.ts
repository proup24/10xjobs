import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signature } from './sign';

describe('signature', () => {
  it('signs "<timestamp>.<body>" with the secret', () => {
    const body = '{"a":1}';
    const expected = createHmac('sha256', 's3cret')
      .update(`1700000000.${body}`)
      .digest('hex');
    expect(signature('s3cret', 1700000000, Buffer.from(body))).toBe(
      `v1=${expected}`,
    );
  });

  it('signs the exact UTF-8 body bytes', () => {
    const body = '"🚀 Zürich"';
    const expected = createHmac('sha256', 'k')
      .update(Buffer.concat([Buffer.from('5.'), Buffer.from(body, 'utf8')]))
      .digest('hex');
    expect(signature('k', 5, Buffer.from(body, 'utf8'))).toBe(`v1=${expected}`);
  });
});
