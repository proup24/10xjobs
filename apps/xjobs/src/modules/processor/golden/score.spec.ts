import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture.testing';
import type { Verdict, Verification } from '../schema/fact';
import type { GoldenCase, GoldenRequirement } from './golden';
import {
  callStats,
  type FactScores,
  questionLine,
  reportFileName,
  scoreCase,
  suggestThreshold,
  summarize,
} from './score';

const reviewed = <T>(value: T) => ({ value, reviewed: true });

const req = (
  text: string,
  code: string,
  kind: GoldenRequirement['kind'],
  group: string | null = null,
): GoldenRequirement => ({
  text,
  code,
  kind,
  domain: null,
  years: null,
  group,
});

const verified = (
  verdict: Verdict,
  jevPick: string,
  score = 0.9,
): Verification => ({ verdict, score, jevPick, rounds: 1 });

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
      yearsRequired: { min: 5, max: null },
      contractMonths: null,
      openings: [
        {
          arrangements: ['remote'],
          places: [{ kind: 'region', code: 'EMEA' }],
          placeStrictness: 'limit',
        },
      ],
      requirements: [
        req('Node', 'nodejs', 'main'),
        req('SQL', 'sql', 'must'),
        req('Rust', 'rust', 'nice'),
      ],
      groups: [],
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

  it("reads Jev's answers from the facts' verification", () => {
    const doc = fixtureDocument();
    doc.seniority.verification = verified('confirmed', 'senior');
    doc.arrangement.verification = verified('unconfirmed', 'onsite', 0.5);
    const jev = scoreCase(doc, matchingCase()).jev;
    expect(jev.seniority).toEqual({ score: 0.9, correct: true, agrees: true });
    expect(jev.arrangement).toEqual({
      score: 0.5,
      correct: false,
      agrees: false,
    });
  });

  it('scores yearsRequired as a range', () => {
    const doc = fixtureDocument();
    doc.yearsRequired.value = { min: 5, max: 8 };
    expect(scoreCase(doc, matchingCase()).facts.yearsRequired).toMatchObject({
      correct: 0,
    });
  });
});

/** Scores for one case carrying one Jev answer to `seniority`. */
const withJev = (
  score: number,
  correct: boolean,
  agrees = true,
): FactScores => ({
  caseId: String(score),
  facts: {},
  jev: { seniority: { score, correct, agrees } },
  verdicts: {},
  rejections: [],
  requirements: null,
  rounds: 1,
  generatorCalls: 1,
  verifierCalls: 1,
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

  it('averages cost, rounds and calls per job', () => {
    const report = summarize([
      { ...withJev(0.9, true), costUsd: 0.1, rounds: 1, generatorCalls: 1 },
      {
        ...withJev(0.9, true),
        costUsd: 0.3,
        rounds: 2,
        generatorCalls: 3,
        verifierCalls: 2,
      },
    ]);
    expect(report.costPerJob).toBeCloseTo(0.2);
    expect(report.roundsPerJob).toBe(1.5);
    expect(report.generatorCallsPerJob).toBe(2);
    expect(report.verifierCallsPerJob).toBe(1.5);
  });

  it('suggests a threshold from confirmations only', () => {
    const report = summarize([
      ...Array.from({ length: 10 }, () => withJev(0.9, true)),
      // A disagreement is not a confirmation, whatever its score.
      ...Array.from({ length: 5 }, () => withJev(0.6, false, false)),
    ]);
    expect(report.questions.seniority.suggestedThreshold).toBe(0.9);
    expect(report.questions.seniority.buckets[1]).toMatchObject({ total: 5 });
  });
});

describe('verification report', () => {
  it('shares each closed field among confirmed, unconfirmed and rejected', () => {
    const docs = (
      ['confirmed', 'confirmed', 'unconfirmed', 'rejected'] as const
    ).map((verdict) => {
      const doc = fixtureDocument();
      doc.seniority.verification = verified(verdict, 'senior');
      return scoreCase(doc, matchingCase());
    });
    expect(summarize(docs).verdicts.seniority).toEqual({
      verified: 4,
      confirmed: 0.5,
      unconfirmed: 0.25,
      rejected: 0.25,
    });
  });

  it('measures rejection precision against the golden values', () => {
    const right = fixtureDocument();
    right.verification.dropped = [
      { field: 'arrangement', generatorValue: 'remote', jevPick: 'onsite' },
    ];
    const wrong = fixtureDocument();
    wrong.verification.dropped = [
      { field: 'seniority', generatorValue: 'junior', jevPick: 'senior' },
    ];
    const report = summarize([
      scoreCase(right, matchingCase('a')),
      scoreCase(wrong, matchingCase('b')),
    ]);
    expect(report.rejections).toBe(2);
    expect(report.rejectionPrecision).toBe(0.5);
  });

  it('counts a missed junk flag as a rejection of "no"', () => {
    const doc = fixtureDocument();
    doc.verification.missedJunkFlags = ['vague'];
    const c = matchingCase();
    c.expected.junkFlags = ['vague'];
    expect(scoreCase(doc, c).rejections).toEqual([
      { field: 'junk:vague', wrong: true },
    ]);
  });

  it('counts generator and verifier calls from the attempt rows', () => {
    expect(
      callStats([
        { step: 'generation', costUsd: 0.1 },
        { step: 'generation_retry', costUsd: 0.05 },
        { step: 'verification', costUsd: 0.01 },
        { step: 'generation', costUsd: 0.1 },
      ]),
    ).toEqual({ generatorCalls: 3, verifierCalls: 1, costUsd: 0.26 });
  });
});

describe('requirement scores', () => {
  it('counts a grouped golden option the generator missed against recall only', () => {
    const doc = fixtureDocument();
    doc.techStack.value = {
      requirements: [
        {
          technology: { text: 'Python', code: 'python' },
          kind: 'main',
          importance: 9,
          domain: null,
          years: null,
          quote: '',
          confidence: 'sure',
          group: null,
        },
      ],
      groups: [],
    };
    const c = matchingCase();
    c.expected.requirements = [
      req('Python', 'python', 'main', 'g1'),
      req('Go', 'go', 'main', 'g1'),
    ];
    c.expected.groups = [{ id: 'g1', min: 1 }];
    const r = summarize([scoreCase(doc, c)]).requirements;
    expect(r.requiredRecall).toBe(0.5);
    expect(r.requiredPrecision).toBe(1);
    expect(r.kindAccuracy).toBe(1);
  });

  it('scores nice requirements apart and reads kind', () => {
    const doc = fixtureDocument();
    const c = matchingCase();
    c.expected.requirements = [
      req('Node', 'nodejs', 'main'),
      req('SQL', 'sql', 'nice'),
      req('Rust', 'rust', 'nice'),
    ];
    const r = summarize([scoreCase(doc, c)]).requirements;
    expect(r.requiredRecall).toBe(1);
    expect(r.requiredPrecision).toBe(0.5);
    expect(r.niceRecall).toBe(0.5);
    expect(r.nicePrecision).toBe(1);
    expect(r.kindAccuracy).toBeCloseTo(2 / 3);
  });

  it('skips domain and years until a human labels them', () => {
    const doc = fixtureDocument();
    const c = matchingCase();
    c.expected.requirements = [
      {
        ...req('Node', 'nodejs', 'main'),
        domain: 'backend',
        years: { min: 3, max: null },
      },
    ];
    c.drafted.requirements = { value: null, reviewed: false };
    expect(summarize([scoreCase(doc, c)]).requirements).toMatchObject({
      domainAccuracy: null,
      yearsAccuracy: null,
    });
    c.drafted.requirements = { value: null, reviewed: true };
    expect(summarize([scoreCase(doc, c)]).requirements).toMatchObject({
      domainAccuracy: 0,
      yearsAccuracy: 0,
    });
  });
});

describe('reportFileName', () => {
  it('names the report after the generator model', () => {
    expect(reportFileName('anthropic/claude-opus-5.5')).toBe(
      'last-report.anthropic-claude-opus-5-5.json',
    );
    expect(reportFileName('deepseek/deepseek-v4.1-flash-1017')).toBe(
      'last-report.deepseek-deepseek-v4-1-flash-1017.json',
    );
  });
});
