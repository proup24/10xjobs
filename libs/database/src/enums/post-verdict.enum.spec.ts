import {
  JUNK_REASONS,
  LISTED_VERDICTS,
  NOT_HIRING_REASONS,
  POST_VERDICT_REASONS,
  VERDICTS,
} from './index';

describe('post verdict codes', () => {
  it('lists the two non-hiring verdicts, in VERDICTS order', () => {
    expect(LISTED_VERDICTS).toEqual(VERDICTS.filter((v) => v !== 'hiring'));
  });

  it('gives every not-hiring and junk reason once, never hiring', () => {
    expect([...POST_VERDICT_REASONS].sort()).toEqual(
      [...new Set([...NOT_HIRING_REASONS, ...JUNK_REASONS])].sort(),
    );
    expect(new Set(POST_VERDICT_REASONS).size).toBe(
      POST_VERDICT_REASONS.length,
    );
    expect(POST_VERDICT_REASONS).not.toContain('hiring');
  });
});
