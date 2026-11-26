import { POST_MAX_AGE_DAYS } from '../config/matcher.config';
import { rolePost } from './fixtures.testing';
import { checkBlockedAuthor, checkHiringVerdict, checkPostAge } from './post';

describe('checkHiringVerdict', () => {
  it('unsure verdict fails as unsure on verdict', () => {
    expect(
      checkHiringVerdict(rolePost({ verdictConfidence: 'unsure' })),
    ).toMatchObject({
      rule: 'hiringVerdict',
      outcome: 'fail',
      unsure: true,
      unsureField: 'verdict',
      reason: "the post's hiring verdict is unsure",
    });
  });

  it('sure verdict passes', () => {
    expect(checkHiringVerdict(rolePost())).toMatchObject({
      outcome: 'pass',
      unsure: false,
      reason: 'the post is hiring',
    });
  });
});

describe('checkBlockedAuthor', () => {
  const authors = [
    { key: 'profile:orig', name: 'Olga' },
    { key: 'profile:sharer', name: 'Sam' },
  ];

  it('a blocked sharer blocks the post', () => {
    expect(
      checkBlockedAuthor(rolePost({ authors }), ['profile:sharer']),
    ).toMatchObject({
      rule: 'blockedAuthor',
      outcome: 'fail',
      unsure: false,
      jobValue: ['profile:sharer'],
      reason: 'you blocked Sam',
    });
  });

  it('an empty name falls back to the key', () => {
    const post = rolePost({ authors: [{ key: 'profile:x', name: '' }] });
    expect(checkBlockedAuthor(post, ['profile:x']).reason).toBe(
      'you blocked profile:x',
    );
  });

  it('passes when no author is blocked', () => {
    expect(
      checkBlockedAuthor(rolePost({ authors }), ['profile:z']),
    ).toMatchObject({
      outcome: 'pass',
      jobValue: ['profile:orig', 'profile:sharer'],
      profileValue: [],
      reason: 'no author you blocked',
    });
  });

  it('stores only the matched keys, not the whole blocked list', () => {
    expect(
      checkBlockedAuthor(rolePost({ authors }), [
        'profile:a',
        'profile:sharer',
        'profile:b',
      ]).profileValue,
    ).toEqual(['profile:sharer']);
  });

  it('passes when the post has no authors', () => {
    expect(
      checkBlockedAuthor(rolePost({ authors: [] }), ['profile:z']),
    ).toMatchObject({
      outcome: 'pass',
      jobValue: [],
      profileValue: [],
      reason: 'no author you blocked',
    });
  });
});

describe('checkPostAge', () => {
  it('passes at 30.0 days and fails at 30.01', () => {
    expect(POST_MAX_AGE_DAYS).toBe(30);
    expect(checkPostAge(rolePost({ ageDays: 30 }))).toMatchObject({
      outcome: 'pass',
      jobValue: 30,
      reason: 'posted 30 days ago',
    });
    expect(checkPostAge(rolePost({ ageDays: 30.01 }))).toMatchObject({
      outcome: 'fail',
      unsure: false,
      reason: 'posted 30 days ago',
    });
  });

  it('fails just after the 30-day mark the sweep re-decides at', () => {
    expect(checkPostAge(rolePost({ ageDays: 30.003 })).outcome).toBe('fail');
  });

  it('fails at 31 days', () => {
    expect(checkPostAge(rolePost({ ageDays: 31 }))).toMatchObject({
      outcome: 'fail',
      reason: 'posted 31 days ago',
    });
  });

  it('stores the age rounded to 2 decimals', () => {
    expect(checkPostAge(rolePost({ ageDays: 2.0000123 })).jobValue).toBe(2);
    expect(checkPostAge(rolePost({ ageDays: 2.456 })).jobValue).toBe(2.46);
  });

  it('a negative age (clock skew) counts as 0 and passes', () => {
    expect(checkPostAge(rolePost({ ageDays: -0.2 }))).toMatchObject({
      outcome: 'pass',
      jobValue: 0,
      reason: 'posted 0 days ago',
    });
  });

  it('a null age is unknown', () => {
    expect(checkPostAge(rolePost({ ageDays: null }))).toMatchObject({
      rule: 'postAge',
      outcome: 'unknown',
      unsure: false,
      reason: "the post's date is unknown",
    });
  });
});
