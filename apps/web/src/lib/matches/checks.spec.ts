import { describe, expect, it } from 'vitest';
import { checkLines, notCheckedText, type Labels } from './checks';

const labels: Labels = {
  positions: [{ value: 'fullstack_engineer', label: 'Full-stack engineer' }],
  seniorities: [
    { value: 'senior', label: 'Senior' },
    { value: 'staff', label: 'Staff' },
  ],
  techs: [
    { value: 'typescript', label: 'TypeScript', searchable: true },
    { value: 'react', label: 'React', searchable: true },
  ],
  countries: [{ value: 'FR', label: 'France' }],
  regions: [{ value: 'EU', label: 'Europe' }],
  cities: [],
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
