// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LINK_FAILED, SESSION_EXPIRED } from './copy';
import { reasonMessage } from './reason-message';

describe('reasonMessage', () => {
  it('maps known reasons to their copy', () => {
    expect(reasonMessage('expired')).toBe(SESSION_EXPIRED);
    expect(reasonMessage('link')).toBe(LINK_FAILED);
  });

  it.each(['__proto__', 'constructor', 'toString', 'nope', undefined])(
    'gives no banner for %s',
    (reason) => expect(reasonMessage(reason)).toBeUndefined(),
  );

  it('gives no banner for repeated params', () =>
    expect(reasonMessage(['expired', 'link'])).toBeUndefined());
});
