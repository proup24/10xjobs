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
    d.postingLanguages = { codes, confident, closeCalls: [] };
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

  it('a Norwegian (no) profile passes a Bokmål (nb) posting', () => {
    const norwegian = (lang: string): MatchProfile => ({
      ...profile,
      languages: [{ lang, level: 'native' }],
    });
    expect(checkPostingLanguage(doc(['nb']), norwegian('no')).outcome).toBe(
      'pass',
    );
    expect(checkPostingLanguage(doc(['no']), norwegian('nn')).outcome).toBe(
      'pass',
    );
  });

  it('Croatian, Serbian and Bosnian match one another', () => {
    const c = checkPostingLanguage(doc(['sr']), {
      ...profile,
      languages: [{ lang: 'hr', level: 'fluent' }],
    });
    expect(c.outcome).toBe('pass');
    expect(
      checkPostingLanguage(doc(['bs']), {
        ...profile,
        languages: [{ lang: 'sr', level: 'working' }],
      }).outcome,
    ).toBe('pass');
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
