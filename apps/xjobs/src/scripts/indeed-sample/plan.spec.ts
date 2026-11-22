import { describe, expect, it } from 'vitest';
import { ACTORS, type ActorName } from './actors';
import {
  RUN_TIMEOUT_SECS,
  TOTAL_CAP_USD,
  buildPlan,
  isCoreSearch,
  parseEventPrices,
  reserveUsd,
  sampleSearches,
  type EventPrices,
  type Keywords,
} from './plan';

const KEYWORDS: Keywords = {
  plain: 'software engineer',
  real: {
    'us-remote': 'senior typescript engineer',
    'uk-remote': 'senior node engineer',
    'ma-onsite': 'ingenieur logiciel',
  },
};

const MEMO23_PRICES: EventPrices = {
  'apify-default-dataset-item': 0.00149,
  'additional-data': 0.001,
  'apify-actor-start': 0.007,
};

const PRICES: Record<ActorName, EventPrices> = {
  valig: { 'apify-default-dataset-item': 0.0001, 'apify-actor-start': 0.001 },
  kaix: { 'apify-default-dataset-item': 0.00005, 'apify-actor-start': 0.00001 },
  memo23: MEMO23_PRICES,
  curious_coder: {
    'apify-default-dataset-item': 0.0001,
    'apify-actor-start': 0.0001,
  },
};

function doubled(): Record<ActorName, EventPrices> {
  const out = {} as Record<ActorName, EventPrices>;
  for (const actor of Object.keys(PRICES) as ActorName[]) {
    out[actor] = Object.fromEntries(
      Object.entries(PRICES[actor]).map(([event, usd]) => [event, usd * 2]),
    );
  }
  return out;
}

describe('sampleSearches', () => {
  it('returns the six core searches', () => {
    const searches = sampleSearches(KEYWORDS);
    expect(searches.map((s) => s.id)).toEqual([
      'us-remote-plain',
      'us-remote-real',
      'uk-remote-plain',
      'uk-remote-real',
      'ma-onsite-plain',
      'ma-onsite-real',
    ]);
    expect(searches.filter((s) => s.place === 'ma-onsite')).toSatisfy(
      (list: { remoteBy: string }[]) =>
        list.length === 2 && list.every((s) => s.remoteBy === 'none'),
    );
    expect(
      searches.filter((s) => s.place !== 'ma-onsite').map((s) => s.remoteBy),
    ).toEqual(['filter', 'filter', 'filter', 'filter']);
    expect(searches.every((s) => !s.seniorOnly)).toBe(true);
    expect(searches[0].keyword).toBe('software engineer');
    expect(searches[1].keyword).toBe('senior typescript engineer');
  });

  it('isCoreSearch is true for core searches only', () => {
    for (const s of sampleSearches(KEYWORDS))
      expect(isCoreSearch(s)).toBe(true);
    const probes = buildPlan(KEYWORDS, PRICES).runs.filter(
      (r) => !isCoreSearch(r.search),
    );
    expect(probes.map((r) => r.search.id)).toEqual([
      'us-locremote-plain',
      'us-locremote-plain',
      'us-remote-plain-senior',
    ]);
  });
});

describe('buildPlan', () => {
  const plan = buildPlan(KEYWORDS, PRICES);
  const byActor = (actor: ActorName) =>
    plan.runs.filter((r) => r.actor === actor);

  it('plans 27 runs in actor order', () => {
    expect(plan.runs).toHaveLength(27);
    expect(plan.runs.map((r) => r.actor)).toEqual([
      ...Array(6).fill('valig'),
      ...Array(7).fill('kaix'),
      ...Array(8).fill('memo23'),
      ...Array(6).fill('curious_coder'),
    ]);
  });

  it('uses Remote as location on actors without a remote filter', () => {
    for (const actor of ['valig', 'curious_coder'] as const) {
      const runs = byActor(actor);
      expect(runs).toHaveLength(6);
      expect(
        runs
          .filter((r) => r.search.place !== 'ma-onsite')
          .every((r) => r.search.remoteBy === 'location'),
      ).toBe(true);
      expect(
        runs
          .filter((r) => r.search.place === 'ma-onsite')
          .every((r) => r.search.remoteBy === 'none'),
      ).toBe(true);
    }
  });

  it('gives kaix 7 runs: core plus us-locremote-plain', () => {
    const runs = byActor('kaix');
    expect(runs.map((r) => r.search.id)).toEqual([
      ...sampleSearches(KEYWORDS).map((s) => s.id),
      'us-locremote-plain',
    ]);
    const core = runs.slice(0, 6);
    expect(
      core
        .filter((r) => r.search.place !== 'ma-onsite')
        .every((r) => r.search.remoteBy === 'filter'),
    ).toBe(true);
    const probe = runs[6].search;
    expect(probe).toMatchObject({
      place: 'us-remote',
      keywordKind: 'plain',
      keyword: 'software engineer',
      remoteBy: 'location',
      seniorOnly: false,
    });
  });

  it('gives memo23 8 runs with a senior-only probe', () => {
    const runs = byActor('memo23');
    expect(runs.map((r) => r.search.id).slice(6)).toEqual([
      'us-locremote-plain',
      'us-remote-plain-senior',
    ]);
    expect(runs[7].search).toMatchObject({
      place: 'us-remote',
      remoteBy: 'filter',
      seniorOnly: true,
    });
    expect(runs[7].input).toMatchObject({ experienceLevel: 'SENIOR_LEVEL' });
  });

  it('builds inputs and reservations from the actor specs', () => {
    for (const run of plan.runs) {
      expect(run.input).toEqual(ACTORS[run.actor].buildInput(run.search));
      expect(run.reservedUsd).toBe(
        reserveUsd(ACTORS[run.actor], PRICES[run.actor]),
      );
    }
    const sum = plan.runs.reduce((acc, r) => acc + r.reservedUsd, 0);
    expect(plan.reservedUsd).toBeCloseTo(sum, 10);
    // A full kaix run (100 rows at 0.00005 + 0.00001 start) charges $0.00501
    // against a $0.01 reservation: the unrounded worst case is kept apart.
    const kaix = plan.runs.find((r) => r.actor === 'kaix');
    expect(kaix?.worstCaseUsd).toBeCloseTo(0.00501, 10);
    expect(kaix?.reservedUsd).toBe(0.01);
    expect(plan.reservedUsd).toBe(Math.round(plan.reservedUsd * 100) / 100);
  });

  it("records each run's memory and timeout", () => {
    for (const run of plan.runs) {
      expect(run.memoryMbytes).toBe(ACTORS[run.actor].memoryMbytes);
      expect(run.timeoutSecs).toBe(RUN_TIMEOUT_SECS);
    }
  });

  it('refuses a live event the actor does not account for', () => {
    expect(() =>
      buildPlan(KEYWORDS, {
        ...PRICES,
        memo23: { ...MEMO23_PRICES, 'mystery-fee': 0.01 },
      }),
    ).toThrow(/memo23.*mystery-fee/);
    expect(() =>
      buildPlan(KEYWORDS, {
        ...PRICES,
        kaix: { ...PRICES.kaix, 'contact-email': 0.05 },
      }),
    ).toThrow(/kaix.*contact-email/);
  });

  it("accepts memo23's contact-email event, which its input keeps off", () => {
    const live = buildPlan(KEYWORDS, {
      ...PRICES,
      memo23: { ...MEMO23_PRICES, 'contact-email': 0.05 },
    });
    expect(live.reservedUsd).toBe(plan.reservedUsd);
  });

  it('fits the cap at the current prices and not at double', () => {
    expect(plan.capUsd).toBe(TOTAL_CAP_USD);
    expect(plan.reservedUsd).toBeLessThanOrEqual(1.5);
    expect(plan.fits).toBe(true);
    const doubledPlan = buildPlan(KEYWORDS, doubled());
    expect(doubledPlan.fits).toBe(false);
    expect(doubledPlan.reservedUsd).toBeGreaterThan(1.5);
  });
});

describe('reserveUsd', () => {
  it('rounds memo23 up to 0.14 at its 1024 MB', () => {
    expect(ACTORS.memo23.memoryMbytes).toBe(1024);
    expect(reserveUsd(ACTORS.memo23, MEMO23_PRICES)).toBe(0.14);
  });

  it('reserves one start event per started GB of memory, at least one', () => {
    // 50 × 0.00249 = 0.1245, plus 4 start events of 0.007: 0.1525 → 0.16.
    expect(
      reserveUsd({ ...ACTORS.memo23, memoryMbytes: 4096 }, MEMO23_PRICES),
    ).toBe(0.16);
    // 1025 MB is two started GB: 0.1245 + 0.014 = 0.1385 → 0.14.
    expect(
      reserveUsd({ ...ACTORS.memo23, memoryMbytes: 1025 }, MEMO23_PRICES),
    ).toBe(0.14);
    // valig at 128 MB still pays one start event: 0.01 + 0.001 → 0.02.
    expect(ACTORS.valig.memoryMbytes).toBe(128);
    expect(reserveUsd(ACTORS.valig, PRICES.valig)).toBe(0.02);
  });

  it('throws naming the actor and the missing event', () => {
    const rest = { ...MEMO23_PRICES };
    delete rest['additional-data'];
    expect(() => reserveUsd(ACTORS.memo23, rest)).toThrow(
      /memo23.*additional-data/,
    );
  });
});

describe('parseEventPrices', () => {
  const act = {
    data: {
      pricingInfos: [
        {
          pricingModel: 'PAY_PER_EVENT',
          pricingPerEvent: {
            actorChargeEvents: {
              'apify-default-dataset-item': { eventPriceUsd: 9 },
            },
          },
        },
        {
          pricingModel: 'PAY_PER_EVENT',
          pricingPerEvent: {
            actorChargeEvents: {
              'apify-default-dataset-item': {
                eventTieredPricingUsd: {
                  FREE: { tieredEventPriceUsd: 0.00149 },
                  BRONZE: { tieredEventPriceUsd: 0.001 },
                },
              },
              'additional-data': { eventPriceUsd: 0.001 },
              'apify-actor-start': { eventPriceUsd: 0.007 },
            },
          },
        },
      ],
    },
  };

  it('on a startedAt tie reads the later entry, flat first and FREE tier otherwise', () => {
    expect(parseEventPrices(act)).toEqual(MEMO23_PRICES);
  });

  const NOW = new Date('2026-11-22T12:00:00Z');
  const entry = (startedAt: string, item: number, start = 0.007) => ({
    pricingModel: 'PAY_PER_EVENT',
    startedAt,
    pricingPerEvent: {
      actorChargeEvents: {
        'apify-default-dataset-item': {
          eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: item } },
        },
        'apify-actor-start': { eventPriceUsd: start },
      },
    },
  });

  it('uses a future price increase', () => {
    const prices = parseEventPrices(
      {
        data: {
          pricingInfos: [
            // Listed out of order: the future entry first.
            entry('2026-12-01T00:00:00Z', 0.002),
            entry('2026-11-01T00:00:00Z', 0.001),
          ],
        },
      },
      NOW,
    );
    expect(prices['apify-default-dataset-item']).toBe(0.002);
  });

  it('ignores a superseded past price, even a higher one', () => {
    const prices = parseEventPrices(
      {
        data: {
          pricingInfos: [
            // Listed out of order: the superseded entry last.
            entry('2026-11-20T00:00:00Z', 0.001),
            entry('2026-11-01T00:00:00Z', 0.009, 0.05),
          ],
        },
      },
      NOW,
    );
    expect(prices).toEqual({
      'apify-default-dataset-item': 0.001,
      'apify-actor-start': 0.007,
    });
  });

  it('keeps the price in force over a future decrease', () => {
    const prices = parseEventPrices(
      {
        data: {
          pricingInfos: [
            entry('2026-11-20T00:00:00Z', 0.001),
            entry('2026-12-01T00:00:00Z', 0.0005),
          ],
        },
      },
      NOW,
    );
    expect(prices['apify-default-dataset-item']).toBe(0.001);
  });

  it('refuses a future entry that is not pay-per-event', () => {
    expect(() =>
      parseEventPrices(
        {
          data: {
            pricingInfos: [
              {
                pricingModel: 'FLAT_PRICE_PER_MONTH',
                startedAt: '2026-12-01T00:00:00Z',
              },
              entry('2026-11-20T00:00:00Z', 0.001),
            ],
          },
        },
        NOW,
      ),
    ).toThrow(/pay-per-event/);
  });

  it('throws when the pay-per-event shape is missing', () => {
    expect(() => parseEventPrices({})).toThrow(/pricingInfos/);
    expect(() => parseEventPrices({ data: { pricingInfos: [] } })).toThrow(
      /pricingInfos/,
    );
    expect(() =>
      parseEventPrices({ data: { pricingInfos: [{ pricingModel: 'FREE' }] } }),
    ).toThrow(/pay-per-event/);
  });
});
