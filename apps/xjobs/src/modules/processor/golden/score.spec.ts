import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture.testing';
import type { GoldenCase } from './golden';
import {
  type FactScores,
  questionLine,
  scoreCase,
  suggestThreshold,
  summarize,
} from './score';

const reviewed = <T>(value: T) => ({ value, reviewed: true });

/** A case whose golden values equal `fixtureDocument()`. */
function matchingCase(id = 'c1'): GoldenCase {
  return {
    id,
    input: {
      title: 'Backend Engineer',
      companyName: 'Acme',
      description: 'Remote in EMEA',
      evidence: {
        location: null,
        contractType: null,
        experienceLevel: null,
        salary: null,
      },
    },
    expected: {
      roleKind: 'backend',
      seniority: 'senior',
      yearsRequired: 5,
      contractMonths: null,
      openings: [
        {
          arrangements: ['remote'],
          places: [{ kind: 'region', code: 'EMEA' }],
          placeStrictness: 'limit',
        },
      ],
      mainStack: [{ anyOf: [{ text: 'Node', code: 'nodejs' }] }],
      requiredLanguages: [{ lang: 'en', level: 'fluent' }],
      sponsorship: 'unstated',
      salary: { min: 80000, max: 100000, currency: 'EUR', period: 'year' },
      junkFlags: [],
    },
    drafted: {
      arrangement: reviewed('remote'),
      contractType: reviewed('full_time'),
      isSoftwareEngineeringRole: reviewed(true),
      engagement: reviewed('employee'),
    },
  };
}

describe('scoreCase', () => {
  it('scores a matching document as fully correct', () => {
    const scores = scoreCase(fixtureDocument(), matchingCase());
    for (const [name, s] of Object.entries(scores.facts))
      expect(s, name).toMatchObject({ correct: s!.total });
    expect(Object.keys(scores.facts).length).toBeGreaterThanOrEqual(12);
  });

  it('ignores a drafted value that is not reviewed', () => {
    const c = matchingCase();
    c.drafted.arrangement = { value: 'onsite', reviewed: false };
    const scores = scoreCase(fixtureDocument(), c);
    expect(scores.facts.arrangement).toBeUndefined();
  });

  it('flags a sure fact the golden value contradicts', () => {
    const doc = fixtureDocument();
    doc.seniority.value = 'junior';
    const scores = scoreCase(doc, matchingCase());
    expect(scores.facts.seniority).toMatchObject({
      correct: 0,
      total: 1,
      confidence: 'sure',
    });
  });

  it('takes Jev answers from the document when none are passed', () => {
    const doc = fixtureDocument();
    doc.seniority.score = 0.9;
    expect(scoreCase(doc, matchingCase()).jev.seniority).toEqual({
      score: 0.9,
      correct: true,
    });
  });
});

/** Scores for one case carrying one Jev answer to `seniority`. */
const withJev = (score: number, correct: boolean): FactScores => ({
  caseId: String(score),
  facts: {},
  jev: { seniority: { score, correct } },
  costUsd: 0,
});

describe('openingPlaces confidence', () => {
  it('is unsure when there are no openings', () => {
    const doc = fixtureDocument();
    doc.openings = [];
    const c = matchingCase();
    c.expected.openings = [];
    expect(scoreCase(doc, c).facts.openingPlaces?.confidence).toBe('unsure');
  });

  it('is sure when every opening is sure', () => {
    expect(
      scoreCase(fixtureDocument(), matchingCase()).facts.openingPlaces
        ?.confidence,
    ).toBe('sure');
  });
});

describe('summarize', () => {
  it('passes when every bar holds', () => {
    const report = summarize([
      scoreCase(fixtureDocument(), matchingCase('a')),
      scoreCase(fixtureDocument(), matchingCase('b')),
    ]);
    expect(report.facts.arrangement.accuracy).toBe(1);
    expect(report.facts.openingPlaces.accuracy).toBe(1);
    expect(report.facts.mainStack.accuracy).toBe(1);
    expect(report.sureContradicted).toBe(0);
    expect(report.pass).toBe(true);
  });

  it('counts a sure wrong seniority in sureContradicted and fails', () => {
    const doc = fixtureDocument();
    doc.seniority.value = 'junior';
    const report = summarize([scoreCase(doc, matchingCase())]);
    expect(report.sureContradicted).toBeGreaterThan(0);
    expect(report.pass).toBe(false);
  });

  it('does not pass without reviewed arrangement labels', () => {
    const c = matchingCase();
    delete c.drafted.arrangement;
    const report = summarize([scoreCase(fixtureDocument(), c)]);
    expect(report.facts.arrangement.accuracy).toBeNull();
    expect(report.pass).toBe(false);
  });

  it('suggests the lowest threshold whose accepted answers are 98% right', () => {
    const report = summarize([
      ...Array.from({ length: 5 }, () => withJev(0.95, true)),
      withJev(0.75, false),
      ...Array.from({ length: 5 }, () => withJev(0.85, true)),
    ]);
    expect(report.questions.seniority.suggestedThreshold).toBe(0.85);
    expect(report.questions.seniority.acceptedAtSuggested).toBe(10);
    expect(questionLine('seniority', report.questions.seniority)).toMatch(
      /-> 0\.85 \(accepted 10\)$/,
    );
  });

  it('suggests nothing from fewer than 10 accepted answers', () => {
    const nine = Array.from({ length: 9 }, () => ({
      score: 0.9,
      correct: true,
    }));
    expect(suggestThreshold(nine)).toEqual({ threshold: null, accepted: 0 });
    expect(suggestThreshold([...nine, { score: 0.5, correct: true }])).toEqual({
      threshold: 0.5,
      accepted: 10,
    });
    const report = summarize([withJev(0.95, true), withJev(0.85, true)]);
    expect(report.questions.seniority.suggestedThreshold).toBeNull();
    expect(questionLine('seniority', report.questions.seniority)).toMatch(
      /-> none \(accepted 0\)$/,
    );
  });

  it('buckets Jev accuracy by score', () => {
    const report = summarize([
      withJev(0.95, true),
      withJev(0.75, false),
      withJev(0.85, true),
      withJev(0.3, false),
    ]);
    const byRange = Object.fromEntries(
      report.questions.seniority.buckets.map((b) => [b.range, b]),
    );
    expect(byRange['0–0.5']).toMatchObject({ total: 1, correct: 0 });
    expect(byRange['0.7–0.8']).toMatchObject({ total: 1, correct: 0 });
    expect(byRange['0.8–0.9']).toMatchObject({ total: 1, correct: 1 });
    expect(byRange['0.9–1']).toMatchObject({ total: 1, correct: 1 });
  });

  it('averages cost per job', () => {
    const report = summarize([
      { ...withJev(0.9, true), costUsd: 0.1 },
      { ...withJev(0.9, true), costUsd: 0.3 },
    ]);
    expect(report.costPerJob).toBeCloseTo(0.2);
  });
});
