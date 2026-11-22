import { ACTORS } from './actors';
import {
  parsePlanFile,
  plannedRuns,
  readResults,
  runFilePath,
  spendFile,
  spentUsd,
  type PlanFile,
  type SpendRun,
} from './files';
import {
  RUN_TIMEOUT_SECS,
  buildPlan,
  type EventPrices,
  type Keywords,
} from './plan';

const K: Keywords = {
  plain: 'developer typescript',
  real: { 'us-remote': 'a', 'uk-remote': 'b', 'ma-onsite': 'c' },
};
const PRICES: EventPrices = {
  'apify-default-dataset-item': 0.001,
  'apify-actor-start': 0.001,
};
const plan = buildPlan(K, {
  valig: PRICES,
  kaix: PRICES,
  memo23: { ...PRICES, 'additional-data': 0.001 },
  curious_coder: PRICES,
});

const planFile: PlanFile = {
  dryRun: true,
  profile: 'p1',
  keywords: K,
  otherKeywords: { 'us-remote': [], 'uk-remote': [], 'ma-onsite': [] },
  spellings: { 'us-remote': ['typescript'], 'uk-remote': [], 'ma-onsite': [] },
  baselineDay: '2026-11-21',
  baseline: {
    'us-remote': { costUsd: 1, relevant: 2, perRelevantUsd: 0.5 },
    'uk-remote': { costUsd: 0, relevant: 0, perRelevantUsd: null },
    'ma-onsite': { costUsd: 0, relevant: 0, perRelevantUsd: null },
  },
  runs: plan.runs.map((r) => ({
    actor: r.actor,
    searchId: r.search.id,
    search: r.search,
    input: r.input,
    reservedUsd: r.reservedUsd,
    memoryMbytes: r.memoryMbytes,
    timeoutSecs: r.timeoutSecs,
  })),
  reservedUsd: plan.reservedUsd,
  capUsd: plan.capUsd,
  fits: plan.fits,
};

describe('parsePlanFile and plannedRuns', () => {
  it('round-trips the plan through JSON', () => {
    const parsed = parsePlanFile(JSON.stringify(planFile));
    expect(parsed).toEqual(planFile);
    expect(plannedRuns(parsed)).toEqual(plan.runs);
  });

  it('fills memory and timeout from the actor spec for an older plan', () => {
    const older = {
      ...planFile,
      runs: planFile.runs.map(
        ({ memoryMbytes: _m, timeoutSecs: _t, ...rest }) => rest,
      ),
    };
    const runs = plannedRuns(parsePlanFile(JSON.stringify(older)));
    expect(runs.map((r) => r.memoryMbytes)).toEqual(
      plan.runs.map((r) => ACTORS[r.actor].memoryMbytes),
    );
    expect(runs.every((r) => r.timeoutSecs === RUN_TIMEOUT_SECS)).toBe(true);
  });

  it('refuses a file without runs, keywords, spellings or baseline', () => {
    for (const key of ['runs', 'keywords', 'spellings', 'baseline'] as const) {
      const broken = { ...planFile, [key]: undefined };
      expect(() => parsePlanFile(JSON.stringify(broken))).toThrow(key);
    }
  });
});

describe('readResults', () => {
  const first = plan.runs[0];
  const path = runFilePath('/f', first.actor, first.search.id);

  it('reads a succeeded run file into a RunResult with readItem', () => {
    const item = { key: 'jk1', title: 'Engineer' };
    const files = new Map([
      [
        path,
        JSON.stringify({
          runId: 'r1',
          status: 'SUCCEEDED',
          usageTotalUsd: 0.12,
          startedAt: '2026-11-22T10:00:00.000Z',
          items: [item],
        }),
      ],
    ]);
    const results = readResults('/f', plan.runs, (p) => files.get(p) ?? null);
    expect(path).toBe(`/f/${first.actor}/${first.search.id}.json`);
    expect(results).toEqual([
      {
        actor: first.actor,
        searchId: first.search.id,
        place: first.search.place,
        costUsd: 0.12,
        scrapedAt: '2026-11-22T10:00:00.000Z',
        jobs: [ACTORS[first.actor].readItem(item)],
      },
    ]);
  });

  it('leaves out missing files and runs that did not succeed', () => {
    const files = new Map([
      [
        path,
        JSON.stringify({
          runId: 'r1',
          status: 'TIMED-OUT',
          usageTotalUsd: 0.3,
          items: [],
        }),
      ],
    ]);
    expect(readResults('/f', plan.runs, (p) => files.get(p) ?? null)).toEqual(
      [],
    );
  });

  it('keeps an unknown cost as null', () => {
    const files = new Map([
      [
        path,
        JSON.stringify({
          runId: 'r1',
          status: 'SUCCEEDED',
          usageTotalUsd: null,
          items: [],
        }),
      ],
    ]);
    const [read] = readResults('/f', plan.runs, (p) => files.get(p) ?? null);
    expect(read.costUsd).toBeNull();
    // A file written before startedAt was saved.
    expect(read.scrapedAt).toBeNull();
  });
});

describe('spendFile', () => {
  it('sums known costs and counts an unknown one at its reservation', () => {
    const runs: SpendRun[] = [
      {
        actor: 'valig',
        searchId: 'us-remote-plain',
        runId: 'r1',
        status: 'SUCCEEDED',
        usageTotalUsd: 0.1234,
        reservedUsd: 0.5,
      },
      {
        actor: 'valig',
        searchId: 'us-remote-real',
        runId: 'r2',
        status: 'STARTED',
        usageTotalUsd: null,
        reservedUsd: 0.31,
      },
    ];
    expect(spentUsd(runs)).toBeCloseTo(0.4334, 10);
    expect(spendFile(runs)).toEqual({
      spentUsd: 0.4334,
      runs: [
        {
          actor: 'valig',
          searchId: 'us-remote-plain',
          runId: 'r1',
          status: 'SUCCEEDED',
          usageTotalUsd: 0.1234,
        },
        {
          actor: 'valig',
          searchId: 'us-remote-real',
          runId: 'r2',
          status: 'STARTED',
          usageTotalUsd: null,
        },
      ],
    });
  });

  it('is zero with no runs', () => {
    expect(spendFile([])).toEqual({ spentUsd: 0, runs: [] });
  });
});
