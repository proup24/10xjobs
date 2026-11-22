import { ACTORS } from './actors';
import {
  parsePlanFile,
  plannedRuns,
  readResults,
  runFilePath,
  type PlanFile,
} from './files';
import { buildPlan, type EventPrices, type Keywords } from './plan';

const K: Keywords = {
  plain: 'developer typescript',
  real: { 'us-remote': 'a', 'uk-remote': 'b', 'ma-onsite': 'c' },
};
const PRICES: EventPrices = {
  'apify-default-dataset-item': 0.001,
  'apify-actor-start': 0.001,
  'additional-data': 0.001,
};
const plan = buildPlan(K, {
  valig: PRICES,
  kaix: PRICES,
  memo23: PRICES,
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
    expect(
      readResults('/f', plan.runs, (p) => files.get(p) ?? null)[0].costUsd,
    ).toBeNull();
  });
});
