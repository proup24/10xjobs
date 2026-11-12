import { exampleProfile, factsDoc } from './fixtures.testing';
import { checkPostingLanguage } from './posting-language';
import type { MatchProfile } from './types';

const profile: MatchProfile = {
  ...exampleProfile(),
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'fr', level: 'working' },
  ],
};

const doc = (codes: string[], confident = true) =>
  factsDoc((d) => {
    d.postingLanguages = { codes, confident };
  });

describe('checkPostingLanguage', () => {
  it('Spanish posting rejects a profile without Spanish', () => {
    const c = checkPostingLanguage(doc(['es']), profile);
    expect(c).toMatchObject({
      rule: 'postingLanguage',
      outcome: 'fail',
      unsure: false,
      unsureField: null,
    });
    expect(c.reason).toContain('es');
  });

  it('bilingual passes with English', () => {
    expect(
      checkPostingLanguage(doc(['de', 'en']), {
        ...profile,
        languages: [{ lang: 'en', level: 'working' }],
      }),
    ).toMatchObject({ outcome: 'pass', unsure: false });
  });

  it('passes at any level', () => {
    expect(checkPostingLanguage(doc(['fr']), profile).outcome).toBe('pass');
  });

  it('not confident is unknown', () => {
    expect(checkPostingLanguage(doc(['es'], false), profile)).toMatchObject({
      outcome: 'unknown',
      unsure: false,
      unsureField: null,
    });
    expect(checkPostingLanguage(doc([], false), profile).outcome).toBe(
      'unknown',
    );
  });
});
