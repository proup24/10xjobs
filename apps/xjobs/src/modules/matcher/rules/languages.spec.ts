import { exampleProfile, factsDoc } from './fixtures.testing';
import { checkRequiredLanguages } from './languages';
import type { MatchProfile } from './types';

type Level = MatchProfile['languages'][number]['level'];

const profile: MatchProfile = {
  ...exampleProfile(),
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'fr', level: 'working' },
  ],
};
const doc = (
  required: [string, Level][] | null,
  confidence: 'sure' | 'unsure' = 'sure',
) =>
  factsDoc((d) => {
    d.requiredLanguages.value =
      required &&
      required.map(([lang, level]) => ({ lang, level, quote: lang }));
    d.requiredLanguages.confidence = confidence;
  });

describe('checkRequiredLanguages', () => {
  it('fail when a required language is missing', () => {
    const c = checkRequiredLanguages(
      doc([
        ['en', 'working'],
        ['de', 'working'],
      ]),
      profile,
    );
    expect(c).toMatchObject({
      rule: 'languages',
      outcome: 'fail',
      unsure: false,
    });
    expect(c.reason).toContain('de');
  });

  it('fail when held below the required level', () => {
    const c = checkRequiredLanguages(doc([['fr', 'fluent']]), profile);
    expect(c).toMatchObject({ outcome: 'fail', unsure: false });
    expect(c.reason).toContain('fr');
  });

  it('pass at or above', () => {
    expect(
      checkRequiredLanguages(
        doc([
          ['en', 'fluent'],
          ['fr', 'working'],
        ]),
        profile,
      ),
    ).toMatchObject({ outcome: 'pass', unsure: false });
    expect(
      checkRequiredLanguages(doc([['en', 'working']]), profile).outcome,
    ).toBe('pass');
    expect(
      checkRequiredLanguages(doc([['en', 'native']]), {
        ...profile,
        languages: [{ lang: 'en', level: 'native' }],
      }).outcome,
    ).toBe('pass');
  });

  it('passes when none required: nothing to check', () => {
    expect(checkRequiredLanguages(doc([]), profile)).toMatchObject({
      outcome: 'pass',
      unsure: false,
      reason: 'job requires no language',
    });
  });

  it('none required on an unsure fact still passes, but rests on it', () => {
    expect(checkRequiredLanguages(doc(null, 'unsure'), profile)).toMatchObject({
      outcome: 'pass',
      unsure: true,
      unsureField: 'requiredLanguages',
      reason: 'job requires no language',
    });
  });

  it('an unsure requirement failure is unsure', () => {
    expect(
      checkRequiredLanguages(doc([['de', 'working']], 'unsure'), profile),
    ).toMatchObject({
      outcome: 'fail',
      unsure: true,
      unsureField: 'requiredLanguages',
    });
  });

  it('a pass on unsure requirements rests on them', () => {
    expect(
      checkRequiredLanguages(doc([['en', 'fluent']], 'unsure'), profile),
    ).toMatchObject({
      outcome: 'pass',
      unsure: true,
      unsureField: 'requiredLanguages',
    });
  });
});
