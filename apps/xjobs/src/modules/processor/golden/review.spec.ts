import { describe, expect, it } from 'vitest';
import type { GoldenCase } from './golden';
import { agreements, confirm, renderReview, reviewItems } from './review';
import type { DraftCheck, FactScores, ListingReportFile } from './score';

const goldenCase = (
  id: string,
  drafted: GoldenCase['drafted'],
): GoldenCase => ({
  id,
  input: { title: `Job ${id}`, description: 'd' },
  expected: {},
  drafted,
});

const check = (label: unknown, got: unknown, agrees: boolean | null) =>
  ({
    label,
    got,
    quote: `q ${String(got)}`,
    confidence: 'sure',
    agrees,
  }) as DraftCheck;

const score = (caseId: string, drafts: FactScores['drafts']): FactScores => ({
  caseId,
  facts: {},
  drafts,
  requirements: null,
  required: null,
  generatorCalls: 1,
  costUsd: 0,
});

const draft = (value: unknown, reviewed = false) => ({ value, reviewed });

const cases = [
  goldenCase('10', {
    arrangement: draft('remote'),
    contractType: draft('full_time'),
    requirements: draft(null),
  }),
  goldenCase('9', {
    arrangement: draft('hybrid', true),
    isSoftwareEngineeringRole: draft(true),
  }),
  // Failed in the eval: no score.
  goldenCase('11', { contractType: draft('contract') }),
];

const report: Pick<ListingReportFile, 'misses' | 'scores'> = {
  misses: [
    {
      caseId: '9',
      title: 'Job 9',
      fact: 'arrangement',
      confidence: 'sure',
      want: 'hybrid',
      got: 'onsite',
      quote: 'in the office',
    },
  ],
  scores: [
    score('10', {
      arrangement: check('remote', 'remote', true),
      contractType: check('full_time', 'contract', false),
      requirements: check([], [], null),
    }),
    score('9', { isSoftwareEngineeringRole: check(true, true, true) }),
  ],
};

describe('reviewItems', () => {
  it('lists eval misses, disagreeing drafts and drafts a human must read', () => {
    const items = reviewItems(report, cases);
    expect(items.map((i) => [i.caseId, i.field, i.reason])).toEqual([
      ['9', 'arrangement', 'differs'],
      ['10', 'contractType', 'disagrees'],
      ['10', 'requirements', 'unreviewed'],
      ['11', 'contractType', 'unreviewed'],
    ]);
    expect(items[1]).toMatchObject({
      title: 'Job 10',
      label: 'full_time',
      got: 'contract',
      quote: 'q contract',
    });
    // No eval answer: the draft is shown alone.
    expect(items[3]).toMatchObject({ label: 'contract', got: undefined });
  });

  it('leaves out agreeing drafts and reviewed ones', () => {
    const fields = reviewItems(report, cases).map(
      (i) => `${i.caseId}.${i.field}`,
    );
    expect(fields).not.toContain('10.arrangement');
    expect(fields).not.toContain('9.isSoftwareEngineeringRole');
  });
});

describe('agreements and confirm', () => {
  it('marks only the drafts the eval agrees with as reviewed', () => {
    const agreed = agreements(report);
    expect(agreed).toEqual([
      { caseId: '10', key: 'arrangement' },
      { caseId: '9', key: 'isSoftwareEngineeringRole' },
    ]);
    const changed = confirm(cases, agreed);
    expect(changed.map((c) => c.id)).toEqual(['10', '9']);
    expect(changed[0].drafted).toEqual({
      arrangement: draft('remote', true),
      contractType: draft('full_time'),
      requirements: draft(null),
    });
    // The input is not changed.
    expect(cases[0].drafted.arrangement?.reviewed).toBe(false);
  });
});

describe('renderReview', () => {
  it('numbers items in batches of 25', () => {
    const item = reviewItems(report, cases)[0];
    const sheet = renderReview(Array.from({ length: 26 }, () => item));
    expect(sheet).toContain('## Batch 1 (items 1–25)');
    expect(sheet).toContain('## Batch 2 (items 26–26)');
    expect(sheet).toContain('### 26. 9: Job 9');
    expect(sheet).toContain('- label: hybrid');
    expect(sheet).toContain('- processor: onsite');
    expect(sheet).toContain('- quote: "in the office"');
  });
});
