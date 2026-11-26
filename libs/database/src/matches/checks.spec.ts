import { describe, expect, it } from 'vitest';
import { checkLines, notCheckedText, ruleLabel, type Labels } from './checks';

const labels: Labels = {
  positions: [{ value: 'fullstack_engineer', label: 'Full-stack engineer' }],
  seniorities: [
    { value: 'senior', label: 'Senior' },
    { value: 'staff', label: 'Staff' },
  ],
  techs: [
    { value: 'typescript', label: 'TypeScript' },
    { value: 'react', label: 'React' },
  ],
  countries: [{ value: 'FR', label: 'France' }],
  regions: [{ value: 'EU', label: 'Europe' }],
  cities: [],
  languages: [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
    { value: 'it', label: 'Italian' },
  ],
  currencies: [
    { value: 'EUR', label: 'Euro' },
    { value: 'USD', label: 'US dollar' },
  ],
  contractTypes: [
    { value: 'full_time', label: 'Full-time' },
    { value: 'contractor', label: 'Contractor' },
  ],
};

// The shape the matcher stores in job_matches.checks (rules/*.ts).
const checks = [
  {
    rule: 'position',
    outcome: 'pass',
    jobValue: 'fullstack_engineer',
    profileValue: 'fullstack_engineer',
    reason: 'job role fullstack_engineer matches your position',
  },
  {
    rule: 'seniority',
    outcome: 'pass',
    jobValue: 'senior',
    profileValue: ['senior', 'staff'],
    reason: 'job seniority senior is in your seniorities [senior, staff]',
  },
  {
    rule: 'location',
    outcome: 'unknown',
    jobValue: [],
    profileValue: {},
    reason:
      'job location (unstated) may fit your wanted arrangements (remote, hybrid)',
    detail: [],
  },
  {
    rule: 'stack',
    outcome: 'pass',
    jobValue: ['typescript', 'react'],
    profileValue: ['typescript'],
    reason: 'job stack covered at 0.713: typescript, react',
    detail: { score: 0.713 },
  },
];

describe('checkLines', () => {
  it('words the four rules with labels instead of codes', () => {
    const lines = checkLines(checks, labels);
    expect(lines.map((l) => l.mark)).toEqual([
      'pass',
      'pass',
      'unknown',
      'pass',
    ]);
    expect(lines.map((l) => l.rule)).toEqual([
      'position',
      'seniority',
      'location',
      'stack',
    ]);
    for (const l of lines) expect(l.text).not.toContain('fullstack_engineer');
    expect(lines[0].text).toBe(
      'Job role Full-stack engineer matches your position',
    );
    expect(lines[3].text).toBe('Job stack covered at 0.713: TypeScript, React');
  });
  it('words the six newer rules, each with its plain-English label', () => {
    const newer = [
      {
        rule: 'salary',
        outcome: 'pass',
        reason:
          'job pays about 95000, at or above your minimum 90000 USD per year',
      },
      { rule: 'currency', outcome: 'pass', reason: 'you accept any currency' },
      {
        rule: 'contractType',
        outcome: 'unknown',
        reason: 'job states no contract type',
      },
      {
        rule: 'languages',
        outcome: 'pass',
        reason: 'job requires no language',
      },
      {
        rule: 'postingLanguage',
        outcome: 'pass',
        reason: 'posting is written in en, which you speak',
      },
      {
        rule: 'workAuthorization',
        outcome: 'pass',
        reason: 'job states no work authorization requirement',
      },
    ];
    const lines = checkLines([...checks, ...newer], labels);
    expect(lines.map((l) => [l.rule, l.label])).toEqual([
      ['position', 'Position'],
      ['seniority', 'Seniority'],
      ['location', 'Location'],
      ['stack', 'Stack'],
      ['salary', 'Salary'],
      ['currency', 'Currency'],
      ['contractType', 'Contract type'],
      ['languages', 'Languages'],
      ['postingLanguage', 'Posting language'],
      ['workAuthorization', 'Work authorization'],
    ]);
    expect(lines[5].text).toBe('You accept any currency');
    expect(lines[6].mark).toBe('unknown');
    expect(lines[9].mark).toBe('pass');
  });
  it('marks a pass that rests on an unsure value', () => {
    const [sure, unsure] = checkLines(
      [
        { rule: 'position', outcome: 'pass', reason: 'a', unsure: false },
        {
          rule: 'seniority',
          outcome: 'pass',
          reason: 'b',
          unsure: true,
          unsureField: 'seniority',
        },
      ],
      labels,
    );
    expect(sure.unsure).toBe(false);
    expect(unsure.unsure).toBe(true);
    expect(unsure.mark).toBe('pass');
  });
  it('marks a failing check as a fail', () => {
    const [line] = checkLines(
      [{ rule: 'seniority', outcome: 'fail', reason: 'x', unsure: true }],
      labels,
    );
    expect(line.mark).toBe('fail');
  });
  it('words language, currency and contract codes from their structured values', () => {
    const lines = checkLines(
      [
        {
          rule: 'languages',
          outcome: 'fail',
          jobValue: [
            { lang: 'it', level: 'fluent' },
            { lang: 'en', level: 'native' },
          ],
          profileValue: [{ lang: 'en', level: 'fluent' }],
          reason:
            "job requires it (fluent; you don't speak it), en (native; you have fluent)",
        },
        {
          rule: 'languages',
          outcome: 'pass',
          jobValue: [{ lang: 'en', level: 'working' }],
          profileValue: [{ lang: 'en', level: 'fluent' }],
          reason: 'you speak every required language: en (working)',
        },
        {
          rule: 'postingLanguage',
          outcome: 'pass',
          jobValue: { codes: ['fr', 'en'], confident: true },
          profileValue: ['en'],
          reason: 'posting is written in en, which you speak',
        },
        {
          rule: 'postingLanguage',
          outcome: 'fail',
          jobValue: { codes: ['it'], confident: true },
          profileValue: ['en'],
          reason: "posting is written in it, which you don't speak",
        },
        {
          rule: 'currency',
          outcome: 'fail',
          jobValue: 'EUR',
          profileValue: ['USD'],
          reason: 'job pays in EUR; you accept [USD]',
        },
        {
          rule: 'currency',
          outcome: 'pass',
          jobValue: 'USD',
          profileValue: ['USD', 'EUR'],
          reason: 'job pays in USD, which you accept',
        },
        {
          rule: 'contractType',
          outcome: 'fail',
          jobValue: 'contractor',
          profileValue: ['full_time'],
          reason:
            'job contract contractor is not in your contract types [full_time]',
        },
      ],
      labels,
    );
    expect(lines.map((l) => l.text)).toEqual([
      "Job requires Italian (fluent; you don't speak it), English (native; you have fluent)",
      'You speak every required language: English (working)',
      'Posting is written in English, which you speak',
      "Posting is written in Italian, which you don't speak",
      'Job pays in Euro; you accept US dollar',
      'Job pays in US dollar, which you accept',
      'Job contract Contractor is not in your contract types: Full-time',
    ]);
  });
  describe('posting language close calls', () => {
    const withNordic: Labels = {
      ...labels,
      languages: [
        ...labels.languages,
        { value: 'es', label: 'Spanish' },
        { value: 'da', label: 'Danish' },
        { value: 'nb', label: 'Norwegian Bokmål' },
        { value: 'hr', label: 'Croatian' },
        { value: 'sr', label: 'Serbian' },
      ],
    };
    const line = (check: Record<string, unknown>) =>
      checkLines([{ rule: 'postingLanguage', ...check }], withNordic)[0];

    it('words a close call the profile speaks a member of as unknown', () => {
      const l = line({
        outcome: 'unknown',
        jobValue: { codes: [], closeCalls: [['da', 'nb']], confident: true },
        profileValue: ['da'],
        reason: "posting is in one of da, nb; can't tell which",
      });
      expect(l.mark).toBe('unknown');
      expect(l.text).toBe(
        "Posting is in one of Danish, Norwegian Bokmål; can't tell which",
      );
    });

    it('keeps the reason when the detector was not confident', () => {
      expect(
        line({
          outcome: 'unknown',
          jobValue: { codes: [], closeCalls: [['da', 'nb']], confident: false },
          profileValue: ['da'],
          reason: 'posting language not detected with confidence',
        }).text,
      ).toBe('Posting language not detected with confidence');
    });

    it('words a sure code and a close call, neither spoken, as a fail', () => {
      expect(
        line({
          outcome: 'fail',
          jobValue: {
            codes: ['es'],
            closeCalls: [['da', 'nb']],
            confident: true,
          },
          profileValue: ['en'],
          reason:
            "posting is written in es, one of da/nb, which you don't speak",
        }).text,
      ).toBe(
        "Posting is written in Spanish, one of Danish/Norwegian Bokmål, which you don't speak",
      );
    });

    it('does not count Serbian as the Croatian a posting is written in', () => {
      expect(
        line({
          outcome: 'pass',
          jobValue: { codes: ['hr', 'en'], closeCalls: [], confident: true },
          profileValue: ['sr', 'en'],
          reason: 'posting is written in en, which you speak',
        }).text,
      ).toBe('Posting is written in English, which you speak');
    });
  });
  it('keeps the reason when a code has no label or the value is not structured', () => {
    const [line] = checkLines(
      [
        {
          rule: 'currency',
          outcome: 'pass',
          jobValue: 'XYZ',
          profileValue: ['XYZ'],
          reason: 'job pays in XYZ, which you accept',
        },
      ],
      labels,
    );
    expect(line.text).toBe('Job pays in XYZ, which you accept');
  });
  it('skips an unknown rule and non-array input', () => {
    const extra = [
      ...checks,
      { rule: 'engagement', outcome: 'pass', reason: 'x' },
    ];
    expect(checkLines(extra, labels)).toHaveLength(4);
    expect(checkLines(null, labels)).toEqual([]);
  });
});

describe('notCheckedText', () => {
  it('lists what the matcher does not check', () => {
    expect(notCheckedText()).toBe(
      'Not checked yet: engagement. Check it in the post.',
    );
  });
});

describe('ruleLabel', () => {
  it('names the post rules', () => {
    expect(ruleLabel('blockedAuthor')).toBe('Blocked author');
    expect(ruleLabel('hiringVerdict')).toBe('Hiring post');
    expect(ruleLabel('postAge')).toBe('Post age');
  });
});
