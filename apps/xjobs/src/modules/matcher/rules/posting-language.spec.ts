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

const doc = (codes: string[], confident = true, closeCalls: string[][] = []) =>
  factsDoc((d) => {
    d.postingLanguages = { codes, confident, closeCalls };
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
    expect(c.reason).toBe("posting is written in es, which you don't speak");
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

  it('Croatian does not match a sure Serbian posting', () => {
    expect(
      checkPostingLanguage(doc(['sr']), {
        ...profile,
        languages: [{ lang: 'hr', level: 'fluent' }],
      }).outcome,
    ).toBe('fail');
  });

  it('Catalan does not match Spanish', () => {
    expect(
      checkPostingLanguage(doc(['ca']), {
        ...profile,
        languages: [{ lang: 'es', level: 'fluent' }],
      }).outcome,
    ).toBe('fail');
  });

  const only = (lang: string): MatchProfile => ({
    ...profile,
    languages: [{ lang, level: 'native' }],
  });

  it('a close call is unknown for a speaker of one member', () => {
    const c = checkPostingLanguage(doc([], true, [['da', 'nb']]), only('da'));
    expect(c).toMatchObject({
      outcome: 'unknown',
      unsure: false,
      unsureField: null,
    });
    expect(c.reason).toBe("posting is in one of da, nb; can't tell which");
  });

  it('a never-sure group is unknown for a speaker of one member', () => {
    expect(
      checkPostingLanguage(doc([], true, [['id', 'ms']]), only('ms')).outcome,
    ).toBe('unknown');
  });

  it('a close call fails a speaker of none', () => {
    const c = checkPostingLanguage(doc([], true, [['da', 'nb']]), profile);
    expect(c.outcome).toBe('fail');
    expect(c.reason).toBe(
      "posting is written in one of da/nb, which you don't speak",
    );
  });

  it('an exact code beats a close call', () => {
    expect(
      checkPostingLanguage(doc(['en'], true, [['da', 'nb']]), profile).outcome,
    ).toBe('pass');
  });

  it('a Norwegian (no) profile is unknown on a {da, nb} close call', () => {
    expect(
      checkPostingLanguage(doc([], true, [['da', 'nb']]), only('no')).outcome,
    ).toBe('unknown');
  });

  it('a sure code the profile lacks beside a close call it speaks is unknown', () => {
    expect(
      checkPostingLanguage(doc(['es'], true, [['da', 'nb']]), only('da'))
        .outcome,
    ).toBe('unknown');
  });

  it('a sure code and a close call, neither spoken, fail naming both', () => {
    const c = checkPostingLanguage(doc(['es'], true, [['da', 'nb']]), profile);
    expect(c.outcome).toBe('fail');
    expect(c.reason).toBe(
      "posting is written in es, one of da/nb, which you don't speak",
    );
  });

  it('not confident with a close call is unknown', () => {
    const c = checkPostingLanguage(doc([], false, [['da', 'nb']]), only('da'));
    expect(c.outcome).toBe('unknown');
    expect(c.reason).toBe('posting language not detected with confidence');
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
