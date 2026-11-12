import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertGoldenCase, GOLDEN_CASES_DIR, loadGolden } from './golden';

const CASES_DIR = GOLDEN_CASES_DIR;
const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
const cases = loadGolden();
const text = JSON.stringify(cases);

describe('golden set', () => {
  it('parses every case file', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
    expect(cases).toHaveLength(files.length);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('every case input has only title and description', () => {
    for (const c of cases)
      expect(Object.keys(c.input).sort()).toEqual(['description', 'title']);
  });

  it('keeps only the LinkedIn text', () => {
    for (const c of cases) {
      expect(c.input.description).not.toContain('## Company page');
      expect(c.input.description).not.toContain('## LinkedIn post');
    }
  });

  it('has no private or third-party data', () => {
    for (const bad of ['Morocco', 'Souhail']) expect(text).not.toContain(bad);
    // career-hub's `criteria` field; the word itself appears in public postings
    expect(text).not.toContain('"criteria"');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    for (const key of ['roleMatch', 'contactPerson', 'contactEmail', 'covers'])
      expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('"greenhouse"');
    // career-hub's `expected` held the owner's verdict; ours holds facts only
    for (const c of cases)
      expect(Object.keys(c.expected)).not.toContain('verdict');
    expect(text).not.toContain('checkIds');
  });

  it('carries no reviewed drafted values until a human reviews them', () => {
    for (const c of cases)
      for (const d of Object.values(c.drafted))
        expect(typeof d.reviewed).toBe('boolean');
  });
});

/** Case 10317's expected stack before the conversion (career-hub's anyOf groups). */
const V1_10317 = {
  id: '10317',
  input: { title: 't', description: 'd' },
  expected: {
    roleKind: 'fullstack_engineer',
    yearsRequired: null,
    mainStack: [
      {
        anyOf: [
          { text: 'Python', code: 'python' },
          { text: 'Node.js', code: 'nodejs' },
        ],
      },
      {
        anyOf: [
          { text: 'React.js', code: 'react' },
          { text: 'Vue.js', code: 'vue' },
          { text: 'Next.js', code: 'nextjs' },
        ],
      },
    ],
    junkFlags: [],
  },
  drafted: {},
};

describe('convertGoldenCase', () => {
  it('turns case 10317 into 5 requirements in 2 groups', () => {
    const c = convertGoldenCase(structuredClone(V1_10317));
    const requirements = c.expected.requirements ?? [];
    expect(requirements).toHaveLength(5);
    expect(c.expected.groups).toEqual([
      { id: 'g1', min: 1 },
      { id: 'g2', min: 1 },
    ]);
    expect(requirements[0]).toEqual({
      text: 'Python',
      code: 'python',
      kind: 'main',
      domain: null,
      years: null,
      group: 'g1',
    });
    expect(requirements.map((r) => r.group)).toEqual([
      'g1',
      'g1',
      'g2',
      'g2',
      'g2',
    ]);
    expect(c.expected).not.toHaveProperty('mainStack');
    expect(c.drafted.requirements).toEqual({ value: null, reviewed: false });
  });

  it('makes a one-option group a standalone requirement, and years a range', () => {
    const c = convertGoldenCase({
      ...structuredClone(V1_10317),
      expected: {
        yearsRequired: 3,
        mainStack: [{ anyOf: [{ text: 'Go', code: 'go' }] }],
        mustHaves: [{ anyOf: [{ text: 'SQL', code: 'sql' }] }],
        niceToHaves: [
          {
            anyOf: [
              { text: 'AWS', code: 'aws' },
              { text: 'GCP', code: 'gcp' },
            ],
          },
        ],
      },
    });
    expect(c.expected.yearsRequired).toEqual({ min: 3, max: null });
    expect(
      c.expected.requirements?.map((r) => [r.code, r.kind, r.group]),
    ).toEqual([
      ['go', 'main', null],
      ['sql', 'must', null],
      ['aws', 'nice', 'g1'],
      ['gcp', 'nice', 'g1'],
    ]);
    expect(c.expected.groups).toEqual([{ id: 'g1', min: 1 }]);
  });

  it('changes nothing in an already-converted case', () => {
    const once = convertGoldenCase(structuredClone(V1_10317));
    expect(convertGoldenCase(structuredClone(once))).toEqual(once);
    for (const c of cases)
      expect(convertGoldenCase(structuredClone(c))).toEqual(c);
  });

  it('holds all 73 cases in the converted shape', () => {
    expect(cases).toHaveLength(73);
    for (const c of cases) {
      expect(c.expected).not.toHaveProperty('mainStack');
      expect(Array.isArray(c.expected.requirements)).toBe(true);
      const years = c.expected.yearsRequired;
      expect(years === null || typeof years === 'object').toBe(true);
    }
  });
});
