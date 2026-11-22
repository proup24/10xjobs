import { describe, expect, it } from 'vitest';
import type { ActorName, PlaceId, SampleJob, SampleSearch } from './actors';
import type { PlannedRun } from './plan';
import {
  buildReport,
  isFullDescription,
  titleCompanyKey,
  type BaselineInput,
  type DevLookup,
  type RunResult,
} from './report';

const SPELLINGS: Record<PlaceId, string[]> = {
  'us-remote': ['typescript'],
  'uk-remote': ['typescript'],
  'ma-onsite': ['typescript'],
};
const LONG = 'x'.repeat(500);

function job(jk: string | null, over: Partial<SampleJob> = {}): SampleJob {
  return {
    jk,
    title: 'Software Engineer',
    company: `Co ${jk ?? 'none'}`,
    place: 'Remote',
    descriptionText: `TypeScript ${LONG}`,
    applyUrl: null,
    easyApply: null,
    postedAt: '2026-11-21T10:00:00Z',
    remote: true,
    salary: null,
    jobType: null,
    ...over,
  };
}

/** A job that is not relevant (no engineering title). */
function other(jk: string | null, over: Partial<SampleJob> = {}): SampleJob {
  return job(jk, { title: 'Sales Manager', ...over });
}

function placeOf(id: string): PlaceId {
  if (id.startsWith('uk')) return 'uk-remote';
  if (id.startsWith('ma')) return 'ma-onsite';
  return 'us-remote';
}

function planned(actor: ActorName, id: string): PlannedRun {
  const search: SampleSearch = {
    id,
    place: placeOf(id),
    keywordKind: id.includes('real') ? 'real' : 'plain',
    keyword: 'k',
    remoteBy: id.includes('locremote')
      ? 'location'
      : id.startsWith('ma')
        ? 'none'
        : 'filter',
    seniorOnly: id.endsWith('-senior'),
  };
  return {
    actor,
    search,
    input: {},
    reservedUsd: 0.1,
    memoryMbytes: 512,
    timeoutSecs: 900,
  };
}

function result(
  actor: ActorName,
  searchId: string,
  jobs: SampleJob[],
  costUsd: number | null = 0.1,
  scrapedAt: string | null = null,
): RunResult {
  return {
    actor,
    searchId,
    place: placeOf(searchId),
    costUsd,
    scrapedAt,
    jobs,
  };
}

const NO_DEV: DevLookup = { strongKeys: new Set(), titleCompany: new Set() };

const BASELINE: BaselineInput = {
  'us-remote': { costUsd: 1, relevant: 1, perRelevantUsd: 1 },
  'uk-remote': { costUsd: 1, relevant: 1, perRelevantUsd: 1 },
  'ma-onsite': { costUsd: 1, relevant: 1, perRelevantUsd: 1 },
};

function report(
  results: RunResult[],
  over: {
    planned?: PlannedRun[];
    baseline?: BaselineInput;
    dev?: DevLookup;
    strongKeyOf?: (url: string) => string | null;
  } = {},
) {
  return buildReport({
    planned: over.planned ?? results.map((r) => planned(r.actor, r.searchId)),
    results,
    spellings: SPELLINGS,
    baseline: over.baseline ?? BASELINE,
    dev: over.dev ?? NO_DEV,
    strongKeyOf: over.strongKeyOf ?? (() => null),
  });
}

const range = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('isFullDescription', () => {
  it('needs 500 characters and no truncation mark', () => {
    expect(isFullDescription(null)).toBe(false);
    expect(isFullDescription('x'.repeat(499))).toBe(false);
    expect(isFullDescription('x'.repeat(500))).toBe(true);
    expect(isFullDescription('x'.repeat(600) + '…')).toBe(false);
  });
});

describe('titleCompanyKey', () => {
  it('lowercases and trims both parts', () => {
    expect(titleCompanyKey(' Software Engineer ', 'ACME ')).toBe(
      'software engineer|acme',
    );
    expect(titleCompanyKey(null, 'acme')).toBeNull();
  });
});

describe('buildReport distinct and overlap', () => {
  it('counts a jk once within and across runs; null jk adds rows only', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a'), job('a'), job(null)]),
      result('valig', 'us-remote-real', [job('a'), job('b')]),
      result('kaix', 'us-remote-plain', [job('b'), job('c'), job(null)]),
    ]);
    const valig = r.perActor.valig;
    expect(valig.runs.map((x) => [x.searchId, x.rows, x.distinct])).toEqual([
      ['us-remote-plain', 3, 1],
      ['us-remote-real', 2, 2],
    ]);
    expect(valig.distinct).toBe(2);
    expect(valig.relevantByPlace['us-remote']).toBe(2);
    expect(r.perActor.kaix.distinct).toBe(2);
    expect(r.overlap).toContainEqual({ a: 'valig', b: 'kaix', shared: 1 });
    expect(r.overlap).toHaveLength(6);
  });

  it('is plain JSON', () => {
    const r = report([result('valig', 'us-remote-plain', [job('a')])]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('buildReport coverage', () => {
  it('shares jk and full description over all rows', () => {
    const r = report([
      result('valig', 'us-remote-plain', [
        job('a'),
        job(null),
        job('b', { descriptionText: 'short' }),
        job('c', { descriptionText: 'x'.repeat(600) + '…' }),
      ]),
    ]);
    expect(r.perActor.valig.coverage.jk).toBe(0.75);
    expect(r.perActor.valig.coverage.fullDescription).toBe(0.5);
  });

  it('treats a blank jk as no jk everywhere', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a'), job('  '), job('')]),
    ]);
    expect(r.perActor.valig.coverage.jk).toBeCloseTo(1 / 3);
    expect(r.perActor.valig.distinct).toBe(1);
    expect(r.perActor.valig.runs[0].distinct).toBe(1);
    expect(r.perActor.valig.gate.reasons).toContain(
      'jk or description under 95%',
    );
  });

  it('prices 1000 distinct jobs from the total cost', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a'), job('b')], 0.1),
      result('valig', 'ma-onsite-plain', [job('b'), job(null)], 0.3),
    ]);
    expect(r.perActor.valig.costPer1000).toBeCloseTo(200);
  });

  it('gives null coverage and zeros to an actor with no results', () => {
    const r = report([result('valig', 'us-remote-plain', [job('a')])], {
      planned: [
        planned('valig', 'us-remote-plain'),
        planned('kaix', 'ma-onsite-plain'),
      ],
    });
    const kaix = r.perActor.kaix;
    expect(kaix.distinct).toBe(0);
    expect(kaix.costPer1000).toBeNull();
    expect(kaix.coverage.jk).toBeNull();
    expect(kaix.notRun).toEqual(['ma-onsite-plain']);
    expect(kaix.gate).toEqual({
      pass: false,
      reasons: expect.arrayContaining(['no rows']),
    });
    expect(r.perActor.memo23.runs).toEqual([]);
  });
});

describe('buildReport gate', () => {
  /** us: 1 relevant at `usCost`; ma: 1 relevant at `maCost`. */
  function gateRuns(actor: ActorName, usCost: number, maCost: number) {
    return [
      result(actor, 'us-remote-plain', [job(`${actor}u`)], usCost),
      result(actor, 'ma-onsite-plain', [job(`${actor}m`)], maCost),
    ];
  }

  it('fails when 10 of 100 rows lack a description', () => {
    const jobs = range('j', 100).map((jk, i) =>
      i < 10 ? job(jk, { descriptionText: null }) : job(jk),
    );
    const r = report([
      result('valig', 'us-remote-plain', jobs, 0.1),
      result('valig', 'ma-onsite-plain', [], 0),
    ]);
    expect(r.perActor.valig.gate.reasons).toContain(
      'jk or description under 95%',
    );
    expect(r.perActor.valig.gate.pass).toBe(false);
  });

  it('computes cost per relevant job on the gate places, deduped per place', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a'), job('b'), other('z')], 1),
      result('valig', 'us-remote-real', [job('a')], 1),
      result('valig', 'ma-onsite-plain', [job('m')], 1),
      result('valig', 'uk-remote-plain', [job('k')], 5),
    ]);
    // 3 USD over a, b, m.
    expect(r.perActor.valig.costPerRelevantGate).toBe(1);
    expect(r.baseline.gatePerRelevantUsd).toBe(1);
  });

  it('passes at exactly 2.0x the baseline and fails at 2.01x', () => {
    const baseline = {
      ...BASELINE,
      'us-remote': { costUsd: 0.1, relevant: 1, perRelevantUsd: 0.1 },
      'ma-onsite': { costUsd: 0.2, relevant: 2, perRelevantUsd: 0.1 },
    };
    const r = report(
      [...gateRuns('valig', 0.1, 0.3), ...gateRuns('kaix', 0.1, 0.302)],
      { baseline },
    );
    expect(r.perActor.valig.gate).toEqual({ pass: true, reasons: [] });
    expect(r.perActor.kaix.gate.pass).toBe(false);
    expect(r.perActor.kaix.gate.reasons).toEqual([
      'cost per relevant job over 2x baseline',
    ]);
    expect(r.pickOrder).toEqual(['valig']);
  });

  it('fails with no relevant jobs and a null cost per relevant job', () => {
    const r = report([
      result('valig', 'us-remote-plain', [other('a')]),
      result('valig', 'ma-onsite-plain', [other('b')]),
    ]);
    expect(r.perActor.valig.costPerRelevantGate).toBeNull();
    expect(r.perActor.valig.gate.reasons).toEqual(['no relevant jobs']);
  });

  it('fails with cost unknown when a gate run has a null cost', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a')], null),
      result('valig', 'ma-onsite-plain', [job('b')], 0.1),
    ]);
    expect(r.perActor.valig.costUnknownRuns).toEqual(['us-remote-plain']);
    expect(r.perActor.valig.costUsd).toBe(0.1);
    expect(r.perActor.valig.costPerRelevantGate).toBeNull();
    expect(r.perActor.valig.gate.reasons).toEqual(['cost unknown']);
  });

  it('lists cost unknown alongside no relevant jobs', () => {
    const r = report([
      result('valig', 'us-remote-plain', [other('a')], null),
      result('valig', 'ma-onsite-plain', [other('b')], 0.1),
    ]);
    expect(r.perActor.valig.gate.reasons).toEqual([
      'cost unknown',
      'no relevant jobs',
    ]);
  });

  it('cannot judge against a baseline with no relevant jobs', () => {
    const zero = { costUsd: 1, relevant: 0, perRelevantUsd: null };
    const r = report(gateRuns('valig', 0.1, 0.1), {
      baseline: { ...BASELINE, 'us-remote': zero, 'ma-onsite': zero },
    });
    expect(r.baseline.gatePerRelevantUsd).toBeNull();
    expect(r.perActor.valig.gate.reasons).toEqual([
      'baseline has no relevant jobs',
    ]);
  });

  it('never fails on the employer apply link', () => {
    const r = report(gateRuns('valig', 0.1, 0.1));
    expect(r.perActor.valig.coverage.employerApplyLink).toBe(0);
    expect(r.perActor.valig.gate).toEqual({ pass: true, reasons: [] });
  });

  it('keeps probe runs out of the gate numbers but in the totals', () => {
    const r = report([
      ...gateRuns('kaix', 0.1, 0.1),
      result('kaix', 'us-locremote-plain', [job('p1'), job('p2')], 0.5),
    ]);
    const kaix = r.perActor.kaix;
    expect(kaix.relevantByPlace['us-remote']).toBe(1);
    expect(kaix.costPerRelevantGate).toBeCloseTo(0.1);
    expect(kaix.distinct).toBe(4);
    expect(kaix.costUsd).toBeCloseTo(0.7);
  });
});

describe('buildReport charge cap', () => {
  it('flags a run whose cost reached its reservation', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a')], 0.096),
      result('valig', 'us-remote-real', [job('b')], 0.09),
      result('valig', 'ma-onsite-plain', [job('m')], null),
    ]);
    // planned() reserves 0.1 per run.
    expect(
      r.perActor.valig.runs.map((x) => [x.searchId, x.chargeCapReached]),
    ).toEqual([
      ['us-remote-plain', true],
      ['us-remote-real', false],
      ['ma-onsite-plain', false],
    ]);
  });
});

describe('buildReport missing runs', () => {
  it('lists a planned run with no result and still builds', () => {
    const r = report([result('valig', 'us-remote-plain', [job('a')])], {
      planned: [
        planned('valig', 'us-remote-plain'),
        planned('valig', 'ma-onsite-plain'),
      ],
    });
    expect(r.perActor.valig.notRun).toEqual(['ma-onsite-plain']);
    expect(r.perActor.valig.gate).toEqual({
      pass: false,
      reasons: ['gate run missing'],
    });
    expect(r.perActor.valig.relevantByPlace['ma-onsite']).toBe(0);
    expect(r.boolean.valig['ma-onsite']).toEqual({
      plainRelevantShare: null,
      realRelevantShare: null,
    });
  });
});

describe('buildReport probes', () => {
  it('reports the lost share of the remote filter', () => {
    const all = range('r', 50);
    const r = report([
      result(
        'kaix',
        'us-remote-plain',
        all.slice(1).map((jk) => job(jk)),
      ),
      result(
        'kaix',
        'us-locremote-plain',
        all.map((jk) => job(jk, { applyUrl: `https://x.test/${jk}` })),
      ),
    ]);
    const probe = r.probes.remoteFilter.kaix;
    expect(probe?.lostShare).toBe(0.02);
    expect(probe?.both).toBe(49);
    expect(probe?.onlyFiltered).toBe(0);
    expect(probe?.onlyUnfiltered).toBe(1);
    expect(probe?.lost).toEqual([
      {
        jk: 'r0',
        title: 'Software Engineer',
        company: 'Co r0',
        applyUrl: 'https://x.test/r0',
      },
    ]);
  });

  it('compares the memo23 senior filter with the plain search', () => {
    const r = report([
      result('memo23', 'us-remote-plain', [job('a'), job('b')]),
      result('memo23', 'us-remote-plain-senior', [job('a'), job('s')]),
    ]);
    expect(r.probes.seniorFilter.memo23).toMatchObject({
      onlyFiltered: 1,
      onlyUnfiltered: 1,
      both: 1,
      lostShare: 0.5,
    });
  });

  it('keeps raw counts and does not window when neither side is full', () => {
    const r = report([
      result('kaix', 'us-remote-plain', [job('a')]),
      result('kaix', 'us-locremote-plain', [
        job('a'),
        job('old', { postedAt: '2026-11-01T00:00:00Z' }),
      ]),
    ]);
    const probe = r.probes.remoteFilter.kaix;
    expect(probe).toMatchObject({
      filtered: { rows: 1, full: false },
      unfiltered: { rows: 2, full: false },
      windowed: false,
      spanStart: null,
      lostShare: 0.5,
      raw: { onlyFiltered: 0, onlyUnfiltered: 1, both: 1, lostShare: 0.5 },
      note: null,
    });
    expect(probe?.lost.map((j) => j.jk)).toEqual(['old']);
  });

  it('windows to the filtered span when both sides hit the row cap', () => {
    // kaix caps at 100 rows: both sides are full.
    const shared = range('s', 99);
    const r = report([
      result(
        'kaix',
        'us-remote-plain',
        [...shared, 'f'].map((jk) =>
          job(jk, { postedAt: '2026-11-21T10:00:00Z' }),
        ),
      ),
      result('kaix', 'us-locremote-plain', [
        ...shared.map((jk) => job(jk, { postedAt: '2026-11-21T11:00:00Z' })),
        job('old', { postedAt: '2026-11-21T03:00:00Z' }),
      ]),
    ]);
    const probe = r.probes.remoteFilter.kaix;
    expect(probe).toMatchObject({
      filtered: { rows: 100, full: true },
      unfiltered: { rows: 100, full: true },
      windowed: true,
      spanStart: '2026-11-21T10:00:00.000Z',
      unparsedPostedAt: 0,
      onlyFiltered: 1,
      onlyUnfiltered: 0,
      both: 99,
      lost: [],
      lostShare: 0,
      raw: { onlyFiltered: 1, onlyUnfiltered: 1, both: 99, lostShare: 0.01 },
    });
    expect(probe?.note).toMatch(/row cap/);
  });

  it('reads relative posting times against the run scrape time', () => {
    const scrapedAt = '2026-11-21T12:00:00Z';
    const filtered = range('s', 98).map((jk) =>
      job(jk, { postedAt: '2 hours ago' }),
    );
    const r = report([
      result(
        'kaix',
        'us-remote-plain',
        [...filtered, job('x', { postedAt: 'today' }), job('y')],
        0.1,
        scrapedAt,
      ),
      result(
        'kaix',
        'us-locremote-plain',
        [
          ...range('s', 96).map((jk) => job(jk, { postedAt: 'Just posted' })),
          job('old', { postedAt: '30+ days ago' }),
          job('hour', { postedAt: '1 hour ago' }),
          job('odd', { postedAt: 'Posted recently' }),
          job('none', { postedAt: null }),
        ],
        0.1,
        scrapedAt,
      ),
    ]);
    const probe = r.probes.remoteFilter.kaix;
    expect(probe?.windowed).toBe(true);
    expect(probe?.spanStart).toBe('2026-11-21T10:00:00.000Z');
    // 'odd' and 'none' cannot be read and stay inside the span.
    expect(probe?.unparsedPostedAt).toBe(2);
    expect(probe?.lost.map((j) => j.jk)).toEqual(['hour', 'none', 'odd']);
    expect(probe?.lostShare).toBeCloseTo(3 / 99);
  });

  it('cannot read relative times without a scrape time', () => {
    const r = report([
      result(
        'memo23',
        'us-remote-plain',
        range('s', 50).map((jk) => job(jk, { postedAt: '2 hours ago' })),
      ),
      result(
        'memo23',
        'us-remote-plain-senior',
        range('s', 50).map((jk) => job(jk, { postedAt: '1 hour ago' })),
      ),
    ]);
    const senior = r.probes.seniorFilter.memo23;
    expect(senior?.filtered.full).toBe(true);
    expect(senior?.windowed).toBe(false);
    expect(senior?.note).toMatch(/no posting time/);
  });

  it('windows the senior probe the same way', () => {
    // memo23 caps at 50 rows.
    const shared = range('s', 49);
    const r = report([
      result('memo23', 'us-remote-plain', [
        ...shared.map((jk) => job(jk, { postedAt: '2026-11-21T11:00:00Z' })),
        job('old', { postedAt: '2026-11-20T00:00:00Z' }),
      ]),
      result(
        'memo23',
        'us-remote-plain-senior',
        [...shared, 'f'].map((jk) =>
          job(jk, { postedAt: '2026-11-21T10:00:00Z' }),
        ),
      ),
    ]);
    expect(r.probes.seniorFilter.memo23).toMatchObject({
      windowed: true,
      lostShare: 0,
      raw: { lostShare: 0.02 },
    });
  });

  it('leaves a probe out when either side is missing', () => {
    const r = report([
      result('memo23', 'us-locremote-plain', [job('a')]),
      result('kaix', 'us-remote-plain', [job('a')]),
    ]);
    expect(r.probes.remoteFilter).toEqual({});
    expect(r.probes.seniorFilter).toEqual({});
  });
});

describe('buildReport boolean', () => {
  it('shares relevant jobs per run, deduped by jk', () => {
    const r = report([
      result('valig', 'uk-remote-plain', [
        job('a'),
        job('a'),
        other('b'),
        job(null),
      ]),
      result('valig', 'uk-remote-real', [job('c')]),
    ]);
    expect(r.boolean.valig['uk-remote']).toEqual({
      plainRelevantShare: 0.5,
      realRelevantShare: 1,
    });
  });
});

describe('buildReport dev overlap', () => {
  it('counts proven by strong key and likely by title and company', () => {
    const dev: DevLookup = {
      strongKeys: new Set(['gh:1']),
      titleCompany: new Set([
        titleCompanyKey('Software Engineer', 'Co b') as string,
        titleCompanyKey('Software Engineer', 'Co a') as string,
      ]),
    };
    const r = report(
      [
        result('valig', 'us-remote-plain', [
          job('a', { applyUrl: 'https://boards.greenhouse.io/x/jobs/1' }),
          job('b'),
          job('c'),
        ]),
      ],
      {
        dev,
        strongKeyOf: (url) => (url.endsWith('/1') ? 'gh:1' : null),
      },
    );
    expect(r.perActor.valig.devOverlap).toEqual({ proven: 1, likely: 1 });
  });
});

describe('buildReport pickOrder', () => {
  it('ranks passing actors by relevant jobs first', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a')], 0.1),
      result('valig', 'ma-onsite-plain', [job('b')], 0.1),
      result('kaix', 'us-remote-plain', [job('a'), job('c')], 0.1),
      result('kaix', 'ma-onsite-plain', [job('b')], 0.1),
      result('memo23', 'us-remote-plain', [other('x')], 0.1),
    ]);
    expect(r.pickOrder).toEqual(['kaix', 'valig']);
  });

  it('breaks a later tie by gate cost per relevant job, not total cost', () => {
    const r = report([
      result('valig', 'us-remote-plain', [job('a')], 0.1),
      result('valig', 'ma-onsite-plain', [job('m')], 0.1),
      // Not relevant and off the gate places: total cost only.
      result('valig', 'uk-remote-plain', [other('x')], 1),
      result('curious_coder', 'us-remote-plain', [job('a')], 0.15),
      result('curious_coder', 'ma-onsite-plain', [job('m')], 0.15),
    ]);
    expect(r.perActor.valig.costUsd).toBeGreaterThan(
      r.perActor.curious_coder.costUsd,
    );
    expect(r.perActor.valig.costPerRelevantGate).toBeLessThan(
      r.perActor.curious_coder.costPerRelevantGate as number,
    );
    expect(r.pickOrder).toEqual(['valig', 'curious_coder']);
  });

  it('breaks a tie on relevant jobs by passing probes, before cost', () => {
    const r = report([
      result('kaix', 'us-remote-plain', [job('a')], 0.1),
      result('kaix', 'ma-onsite-plain', [job('m')], 0.1),
      result('kaix', 'us-locremote-plain', [job('a')], 0.1),
      result('memo23', 'us-remote-plain', [job('a')], 0.1),
      result('memo23', 'ma-onsite-plain', [job('m')], 0.1),
    ]);
    expect(r.probes.remoteFilter.kaix?.lostShare).toBe(0);
    expect(r.perActor.kaix.costUsd).toBeGreaterThan(r.perActor.memo23.costUsd);
    expect(r.pickOrder).toEqual(['kaix', 'memo23']);
  });
});
