// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isResumeKeyFor, newResumeKey, profileFolder } from './key';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const F = 'abcdefab-cdef-4bcd-8fab-cdefabcdefab';

describe('resume keys', () => {
  it('builds <u>/<p>/<uuid>.pdf', () => {
    expect(newResumeKey(U, P, F)).toBe(`${U}/${P}/${F}.pdf`);
    expect(profileFolder(U, P)).toBe(`${U}/${P}`);
  });

  it('generates a valid key when no uuid is given', () => {
    expect(isResumeKeyFor(newResumeKey(U, P), U, P)).toBe(true);
  });

  it('accepts its own key', () => {
    expect(isResumeKeyFor(`${U}/${P}/${F}.pdf`, U, P)).toBe(true);
  });

  it.each([
    ['another user', `${P}/${P}/${F}.pdf`],
    ['another profile', `${U}/${U}/${F}.pdf`],
    ['a non-UUID segment', `${U}/${P}/nope.pdf`],
    ['an uppercase UUID', `${U}/${P}/${F.toUpperCase()}.pdf`],
    ['a .txt extension', `${U}/${P}/${F}.txt`],
    ['an extra segment', `${U}/${P}/x/${F}.pdf`],
  ])('rejects %s', (_, key) => {
    expect(isResumeKeyFor(key, U, P)).toBe(false);
  });
});
