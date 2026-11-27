import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture.testing';
import type { GoldenCase, GoldenRequirement } from './golden';
import { BARS, callStats, reportFileName, scoreCase, summarize } from './score';

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

/** A case whose golden values equal `fixtureDocument()`. */
function matchingCase(id = 'c1'): GoldenCase {
  return {
    id,
    input: {
      title: 'Backend Engineer',
      description: 'Remote in EMEA',
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

  it('engagement is not scored', () => {
    const c = matchingCase();
    // An old case file may still carry a reviewed engagement label.
    (c.drafted as Record<string, unknown>).engagement = reviewed('contractor');
    const scores = scoreCase(fixtureDocument(), c);
    expect(scores.facts).not.toHaveProperty('engagement');
    expect(summarize([scores]).facts).not.toHaveProperty('engagement');
  });

  it('ignores a drafted value that is not reviewed', () => {
    const c = matchingCase();
    c.drafted.arrangement = { value: 'onsite', reviewed: false };
    const scores = scoreCase(fixtureDocument(), c);
    expect(scores.facts.arrangement).toBeUndefined();
  });

  it('keeps the answer next to each unreviewed draft, to confirm or review it', () => {
    const c = matchingCase();
    c.drafted.arrangement = { value: 'unstated', reviewed: false };
    c.drafted.contractType = { value: 'full_time', reviewed: false };
    c.drafted.requirements = { value: null, reviewed: false };
    const doc = fixtureDocument();
    doc.arrangement.value = null;
    doc.contractType.quote = 'Full-time';
    const { drafts } = scoreCase(doc, c);
    // null and 'unstated' read alike, as in scoring.
    expect(drafts.arrangement).toMatchObject({
      label: 'unstated',
      agrees: true,
    });
    expect(drafts.contractType).toEqual({
      label: 'full_time',
      got: 'full_time',
      quote: 'Full-time',
      confidence: 'sure',
      agrees: true,
    });
    expect(drafts.isSoftwareEngineeringRole).toBeUndefined();
    expect(drafts.requirements).toMatchObject({ agrees: null });
    expect(drafts.requirements?.got).toEqual([
      { text: 'Node', code: 'nodejs', kind: 'main', domain: null, years: null },
      { text: 'SQL', code: 'sql', kind: 'must', domain: null, years: null },
      { text: 'Rust', code: 'rust', kind: 'nice', domain: null, years: null },
    ]);
  });

  it('marks a draft the answer disagrees with', () => {
    const c = matchingCase();
    c.drafted.isSoftwareEngineeringRole = { value: false, reviewed: false };
    expect(
      scoreCase(fixtureDocument(), c).drafts.isSoftwareEngineeringRole,
    ).toMatchObject({ label: false, got: true, agrees: false });
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

  it('scores yearsRequired as a range', () => {
    const doc = fixtureDocument();
    doc.yearsRequired.value = { min: 5, max: 8 };
    expect(scoreCase(doc, matchingCase()).facts.yearsRequired).toMatchObject({
      correct: 0,
    });
  });

  it('keeps the golden value, the answer and its quote to read a miss', () => {
    const doc = fixtureDocument();
    doc.seniority.value = 'junior';
    doc.seniority.quote = 'Junior developer';
    expect(scoreCase(doc, matchingCase()).facts.seniority).toMatchObject({
      want: 'senior',
      got: 'junior',
      quote: 'Junior developer',
    });
  });

  it('lists opening places as compared, and required codes missed or added', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [{ kind: 'worldwide' }];
    doc.techStack.value!.requirements = doc.techStack.value!.requirements.map(
      (r) =>
        r.technology.code === 'sql'
          ? { ...r, technology: { code: 'go', text: 'Go' } }
          : r,
    );
    const scores = scoreCase(doc, matchingCase());
    expect(scores.facts.openingPlaces).toMatchObject({
      want: ['region:EMEA'],
      got: ['worldwide'],
    });
    expect(scores.required).toEqual({ missing: ['sql'], extra: ['go'] });
  });

  it('has no required diff without golden requirements', () => {
    const c = matchingCase();
    delete c.expected.requirements;
    expect(scoreCase(fixtureDocument(), c).required).toBeNull();
  });
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

  it('reports have no ingest share', () => {
    const report = summarize([scoreCase(fixtureDocument(), matchingCase())]);
    for (const fact of Object.values(report.facts))
      expect(Object.keys(fact).sort()).toEqual(['accuracy', 'scored']);
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

  it('averages cost and generator calls per job', () => {
    const report = summarize([
      scoreCase(fixtureDocument(), matchingCase('a'), {
        costUsd: 0.1,
        generatorCalls: 1,
      }),
      scoreCase(fixtureDocument(), matchingCase('b'), {
        costUsd: 0.3,
        generatorCalls: 3,
      }),
    ]);
    expect(report.costPerJob).toBeCloseTo(0.2);
    expect(report.generatorCallsPerJob).toBe(2);
  });

  it('reports only generator metrics, with the bars unchanged', () => {
    const report = summarize([scoreCase(fixtureDocument(), matchingCase())]);
    for (const key of [
      'questions',
      'verdicts',
      'rejectionPrecision',
      'rejections',
      'verifierCallsPerJob',
      'roundsPerJob',
    ])
      expect(report).not.toHaveProperty(key);
    expect(Object.keys(report.facts).length).toBeGreaterThanOrEqual(12);
    expect(BARS).toEqual({
      openingPlaces: 0.95,
      arrangement: 0.97,
      mainStack: 0.9,
      sureContradicted: 0.02,
    });
    expect(Object.keys(report.bars).sort()).toEqual(Object.keys(BARS).sort());
  });

  it('counts generator calls from the attempt rows', () => {
    expect(
      callStats([
        { step: 'generation', costUsd: 0.1 },
        { step: 'generation_retry', costUsd: 0.05 },
        { step: 'generation', costUsd: 0.1 },
      ]),
    ).toEqual({ generatorCalls: 3, costUsd: 0.25 });
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

  it('reads a null domain or years in a reviewed label as not labeled', () => {
    const doc = fixtureDocument();
    const [node, sql] = doc.techStack.value?.requirements ?? [];
    Object.assign(node, { domain: 'backend', years: { min: 2, max: null } });
    Object.assign(sql, { domain: 'data', years: { min: 5, max: null } });
    const c = matchingCase();
    c.drafted.requirements = { value: null, reviewed: true };
    c.expected.requirements = [
      req('Node', 'nodejs', 'main'),
      req('SQL', 'sql', 'must'),
    ];
    expect(summarize([scoreCase(doc, c)]).requirements).toMatchObject({
      domainAccuracy: null,
      yearsAccuracy: null,
    });
  });

  it('still scores a non-null domain or years in a reviewed label', () => {
    const doc = fixtureDocument();
    const [node, sql] = doc.techStack.value?.requirements ?? [];
    Object.assign(node, { domain: 'backend', years: { min: 2, max: null } });
    Object.assign(sql, { domain: 'data', years: { min: 5, max: null } });
    const c = matchingCase();
    c.drafted.requirements = { value: null, reviewed: true };
    c.expected.requirements = [
      req('Node', 'nodejs', 'main'),
      { ...req('SQL', 'sql', 'must'), domain: 'backend' },
      { ...req('Rust', 'rust', 'nice'), years: { min: 1, max: null } },
    ];
    const counts = scoreCase(doc, c).requirements;
    expect(counts).toMatchObject({
      domainRight: 0,
      domainTotal: 1,
      yearsRight: 0,
      yearsTotal: 1,
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
