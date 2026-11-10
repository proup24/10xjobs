import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';
import {
  TOTAL_BUDGET_USD,
  BudgetExceededError,
  buildPairs,
  CAMPAIGN_BUDGET_USD,
  classifyRun,
  createBudget,
  containmentVerdict,
  datedItems,
  judgeContainment,
  filterPairs,
  invocationLimit,
  parseGeoArgs,
  parsePairsFilter,
  planSpend,
  parseSections,
  resolveGeo,
  rowsCap,
  keywordOfLength,
  orForms,
  publishedAtStats,
} from './logic';

describe('createBudget', () => {
  it('allows runs until the total would pass the budget', () => {
    const budget = createBudget(1);
    budget.reserve(0.4);
    budget.reserve(0.6);
    expect(budget.spent()).toBeCloseTo(1);
  });

  it('refuses a run that would push the total past the budget, without counting it', () => {
    const budget = createBudget(1);
    budget.reserve(0.7);
    expect(() => budget.reserve(0.31)).toThrow(/budget/i);
    expect(budget.spent()).toBeCloseTo(0.7);
    budget.reserve(0.3);
  });

  it('defaults to a one dollar budget', () => {
    expect(TOTAL_BUDGET_USD).toBe(1);
    expect(() => createBudget().reserve(1.01)).toThrow();
  });
});

describe('orForms', () => {
  it('builds the three OR spellings', () => {
    expect(orForms(['nestjs', 'next js'])).toEqual({
      quoted: 'nestjs OR "next js"',
      parenthesised: 'nestjs OR (next js)',
      bare: 'nestjs OR next js',
    });
  });

  it('leaves single words unquoted in every form', () => {
    expect(orForms(['go', 'rust']).quoted).toBe('go OR rust');
  });
});

describe('keywordOfLength', () => {
  const terms = Object.values(TECHNOLOGY_TERMS);

  it.each([100, 200, 400, 800])('fits %i chars without passing them', (n) => {
    const keyword = keywordOfLength(n);
    expect(keyword.length).toBeLessThanOrEqual(n);
    expect(keyword.length).toBeGreaterThan(n * 0.8);
    const parts = keyword.split(' OR ');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(terms).toContain(part);
  });
});

describe('containmentVerdict', () => {
  const at = (day: number) => `2026-11-0${day}T10:00:00.000Z`;
  // What the actor really returns: a date, at midnight UTC.
  const day = (d: number) => `2026-11-0${d}T00:00:00.000Z`;
  const full = { parentFull: true };
  const notFull = { parentFull: false };

  it('passes when the parent holds every child job', () => {
    const result = containmentVerdict(
      [{ id: 'a', publishedAt: at(5) }],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(4) },
      ],
      notFull,
    );
    expect(result).toEqual({ verdict: 'pass', missing: [] });
  });

  it('is a row-limit cut when the parent is full and every missing job is older', () => {
    const result = containmentVerdict(
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'old', publishedAt: at(1) },
      ],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(3) },
      ],
      full,
    );
    expect(result).toEqual({ verdict: 'row-limit-cut', missing: ['old'] });
  });

  it('is a row-limit cut for a midnight-only miss on the parent oldest day', () => {
    const result = containmentVerdict(
      [
        { id: 'a', publishedAt: day(5) },
        { id: 'same-day', publishedAt: day(3) },
      ],
      [
        { id: 'a', publishedAt: day(5) },
        { id: 'b', publishedAt: day(3) },
      ],
      full,
    );
    expect(result).toEqual({ verdict: 'row-limit-cut', missing: ['same-day'] });
  });

  it('allows one day of slack for dates rounded in another time zone', () => {
    expect(
      containmentVerdict(
        [{ id: 'x', publishedAt: day(4) }],
        [{ id: 'b', publishedAt: day(3) }],
        full,
      ).verdict,
    ).toBe('row-limit-cut');
    expect(
      containmentVerdict(
        [{ id: 'x', publishedAt: day(5) }],
        [{ id: 'b', publishedAt: day(3) }],
        full,
      ).verdict,
    ).toBe('fail');
  });

  it('ignores parent items with no date when finding the oldest', () => {
    const result = containmentVerdict(
      [{ id: 'old', publishedAt: day(2) }],
      [
        { id: 'b', publishedAt: day(3) },
        { id: 'c', publishedAt: null },
      ],
      full,
    );
    expect(result.verdict).toBe('row-limit-cut');
  });

  it('cannot call a dateless miss from a full parent a fail', () => {
    const result = containmentVerdict(
      [{ id: 'x', publishedAt: null }],
      [{ id: 'b', publishedAt: day(3) }],
      full,
    );
    expect(result.verdict).toBe('row-limit-cut');
  });

  it('fails any miss when the parent was not full, whatever its date', () => {
    expect(
      containmentVerdict(
        [{ id: 'old', publishedAt: day(1) }],
        [{ id: 'b', publishedAt: day(3) }],
        notFull,
      ).verdict,
    ).toBe('fail');
    expect(
      containmentVerdict(
        [{ id: 'x', publishedAt: null }],
        [{ id: 'b', publishedAt: day(3) }],
        notFull,
      ).verdict,
    ).toBe('fail');
  });

  it('fails when a missing job is newer than the parent oldest day', () => {
    const result = containmentVerdict(
      [{ id: 'new', publishedAt: at(6) }],
      [{ id: 'b', publishedAt: at(3) }],
      full,
    );
    expect(result).toEqual({ verdict: 'fail', missing: ['new'] });
  });

  it('fails when the parent is empty and the child is not', () => {
    expect(
      containmentVerdict([{ id: 'x', publishedAt: at(2) }], [], notFull)
        .verdict,
    ).toBe('fail');
  });

  it('calls misses at the start of the window a window edge, not a fail', () => {
    // The window opened during day 2: a day 2 job can age out between the runs.
    const windowStart = Date.parse('2026-11-02T15:00:00Z');
    expect(
      containmentVerdict(
        [{ id: 'edge', publishedAt: day(2) }],
        [{ id: 'b', publishedAt: day(3) }],
        { parentFull: false, windowStart },
      ),
    ).toEqual({ verdict: 'window-edge', missing: ['edge'] });
    expect(
      containmentVerdict(
        [
          { id: 'edge', publishedAt: day(2) },
          { id: 'real', publishedAt: day(4) },
        ],
        [{ id: 'b', publishedAt: day(3) }],
        { parentFull: false, windowStart },
      ).verdict,
    ).toBe('fail');
  });
});

describe('publishedAtStats', () => {
  it('counts parseable dates and non-midnight UTC times', () => {
    const stats = publishedAtStats([
      { publishedAt: '2026-11-05T10:15:00.000Z' },
      { publishedAt: '2026-11-05' },
      { publishedAt: 'not a date' },
      {},
    ]);
    expect(stats).toEqual({
      total: 4,
      parseableShare: 0.5,
      nonMidnightShare: 0.25,
    });
  });

  it('is zero for no items', () => {
    expect(publishedAtStats([])).toEqual({
      total: 0,
      parseableShare: 0,
      nonMidnightShare: 0,
    });
  });
});

describe('budget extras', () => {
  it('throws a BudgetExceededError and reports what is left', () => {
    const budget = createBudget(1);
    budget.reserve(0.75);
    expect(budget.remaining()).toBeCloseTo(0.25);
    expect(() => budget.reserve(0.3)).toThrow(BudgetExceededError);
  });
});

describe('parseGeoArgs', () => {
  it('keys overrides by the location key, case-insensitively', () => {
    const geo = parseGeoArgs(['EMEA=91000000', 'Casablanca,  Morocco=123']);
    expect(geo.get('emea')).toBe('91000000');
    expect(geo.get('casablanca, morocco')).toBe('123');
  });

  it('rejects an argument that is not place=digits', () => {
    expect(() => parseGeoArgs(['emea'])).toThrow(/--geo/);
    expect(() => parseGeoArgs(['emea=abc'])).toThrow(/--geo/);
    expect(() => parseGeoArgs(['=123'])).toThrow(/--geo/);
  });
});

describe('resolveGeo', () => {
  const overrides = parseGeoArgs(['Germany=999']);
  const pinned = { germany: '1', france: '2' };

  it('prefers an override over the pinned table', () => {
    expect(resolveGeo('germany', overrides, pinned)).toEqual({
      geoId: '999',
      source: 'override',
    });
  });

  it('falls back to the pinned table, then to none', () => {
    expect(resolveGeo('France', overrides, pinned)).toEqual({
      geoId: '2',
      source: 'LINKEDIN_GEO_IDS',
    });
    expect(resolveGeo('EMEA', overrides, pinned)).toEqual({
      geoId: undefined,
      source: 'none',
    });
  });
});

describe('resolveGeo with a region code', () => {
  it('finds an override given by code for a place named by label', () => {
    const overrides = parseGeoArgs(['LATAM=555']);
    expect(resolveGeo(['Latin America', 'LATAM'], overrides, {})).toEqual({
      geoId: '555',
      source: 'override',
    });
  });
});

describe('parseSections', () => {
  it('defaults to every section', () => {
    expect([...parseSections(undefined)]).toEqual([
      'or',
      'length',
      'containment',
      'ceiling',
    ]);
  });

  it('selects the named ones and rejects unknown names', () => {
    expect([...parseSections('containment')]).toEqual(['containment']);
    expect(() => parseSections('or,nope')).toThrow(/nope/);
  });
});

describe('buildPairs', () => {
  const geography = {
    regions: [
      { code: 'EMEA', label: 'EMEA' },
      { code: 'EUROPE', label: 'Europe' },
      { code: 'NORTH_AFRICA', label: 'North Africa' },
      { code: 'LATAM', label: 'Latin America' },
      { code: 'NORTH_AMERICA', label: 'North America' },
      { code: 'GLOBAL', label: 'Global' },
    ],
    countries: [
      { code: 'DE', label: 'Germany' },
      { code: 'MA', label: 'Morocco' },
      { code: 'BR', label: 'Brazil' },
      { code: 'CA', label: 'Canada' },
    ],
    cities: [{ name: 'Casablanca', countryCode: 'MA' }],
    links: [
      { regionCode: 'EMEA', countryCode: 'DE' },
      { regionCode: 'EMEA', countryCode: 'MA' },
      { regionCode: 'EUROPE', countryCode: 'DE' },
      { regionCode: 'NORTH_AFRICA', countryCode: 'MA' },
      { regionCode: 'LATAM', countryCode: 'BR' },
      { regionCode: 'NORTH_AMERICA', countryCode: 'CA' },
      ...['DE', 'MA', 'BR', 'CA'].map((c) => ({
        regionCode: 'GLOBAL',
        countryCode: c,
      })),
    ],
  };
  const keys = (places: string[]) =>
    buildPairs(places, geography).map((p) => `${p.child}>${p.parent}`);

  it('pairs a country only with the regions that contain it, once each', () => {
    const pairs = keys(['germany']);
    expect(pairs).toEqual(['germany>EMEA', 'germany>Europe']);
  });

  it('never pairs a place with a region that does not contain it', () => {
    expect(keys(['Canada'])).toEqual(['Canada>North America']);
    expect(keys(['Brazil'])).toEqual(['Brazil>Latin America']);
  });

  it('pairs a city with its country and the regions holding that country', () => {
    const pairs = keys(['Casablanca, Morocco']);
    expect(pairs).toContain('Casablanca, Morocco>Morocco');
    expect(pairs).toContain('Casablanca, Morocco>EMEA');
    expect(pairs).not.toContain('Casablanca, Morocco>Europe');
  });

  it('pairs a region with the regions that hold all of its countries', () => {
    expect(keys(['Europe'])).toEqual(['Europe>EMEA']);
    expect(keys(['North Africa'])).toEqual(['North Africa>EMEA']);
    expect(keys(['Latin America'])).toEqual([]);
  });

  it('names parents by their region label, so LATAM is "Latin America"', () => {
    const pairs = buildPairs(['Brazil', 'Latin America'], geography);
    expect(pairs).toEqual([
      { child: 'Brazil', parent: 'Latin America', parentCode: 'LATAM' },
    ]);
  });

  it('carries a region child its code too', () => {
    expect(buildPairs(['Europe'], geography)).toEqual([
      {
        child: 'Europe',
        childCode: 'EUROPE',
        parent: 'EMEA',
        parentCode: 'EMEA',
      },
    ]);
  });

  it('never uses Global as a parent', () => {
    expect(
      keys(['Germany', 'Morocco']).some((k) => k.endsWith('>Global')),
    ).toBe(false);
  });

  it('skips places it cannot place', () => {
    expect(buildPairs(['atlantis'], geography)).toEqual([]);
  });

  it('runs the worked example folds first: into EMEA, city into country, into LATAM', () => {
    const pairs = keys([
      'Brazil',
      'Casablanca, Morocco',
      'Canada',
      'Germany',
      'Europe',
      'North Africa',
    ]);
    expect(pairs.slice(0, 4)).toEqual([
      'Europe>EMEA',
      'North Africa>EMEA',
      'Germany>EMEA',
      'Casablanca, Morocco>Morocco',
    ]);
    expect(pairs[4]).toBe('Brazil>Latin America');
    expect(pairs.indexOf('Casablanca, Morocco>EMEA')).toBeGreaterThan(4);
  });
});

describe('parsePairsFilter and filterPairs', () => {
  const pairs = [
    { child: 'Europe', parent: 'EMEA', parentCode: 'EMEA' },
    { child: 'Casablanca, Morocco', parent: 'Morocco' },
    { child: 'Brazil', parent: 'Latin America', parentCode: 'LATAM' },
  ];

  it('parses child>parent entries', () => {
    expect(parsePairsFilter('Casablanca>Morocco, Europe>EMEA')).toEqual([
      { child: 'Casablanca', parent: 'Morocco' },
      { child: 'Europe', parent: 'EMEA' },
    ]);
    expect(() => parsePairsFilter('Casablanca')).toThrow(/--pairs/);
    expect(() => parsePairsFilter('>EMEA')).toThrow(/--pairs/);
  });

  it('keeps the matching pairs in run order, by city name or region code', () => {
    const { pairs: kept, unmatched } = filterPairs(
      pairs,
      parsePairsFilter('brazil>LATAM,Casablanca>Morocco'),
    );
    expect(kept.map((p) => p.child)).toEqual(['Casablanca, Morocco', 'Brazil']);
    expect(unmatched).toEqual([]);
  });

  it('reports entries that match no pair', () => {
    expect(
      filterPairs(pairs, parsePairsFilter('Canada>EMEA')).unmatched,
    ).toEqual(['Canada>EMEA']);
  });
});

describe('judgeContainment', () => {
  const good = {
    ok: true,
    items: [{ id: 'a', publishedAt: '2026-11-05T10:00:00Z' }],
  };
  const ctx = { parentFull: false };

  it('is invalid when the child run failed or came back empty', () => {
    expect(
      judgeContainment({ ok: false, items: good.items }, good, ctx).verdict,
    ).toBe('invalid');
    expect(judgeContainment({ ok: true, items: [] }, good, ctx).verdict).toBe(
      'invalid',
    );
  });

  it('is invalid, not fail, when the parent run failed', () => {
    expect(judgeContainment(good, { ok: false, items: [] }, ctx).verdict).toBe(
      'invalid',
    );
  });

  it('otherwise defers to the containment verdict', () => {
    expect(judgeContainment(good, good, ctx)).toEqual({
      verdict: 'pass',
      missing: [],
    });
  });
});

describe('datedItems', () => {
  it('drops items with no id and counts them', () => {
    const result = datedItems([
      { jobId: '1', publishedAt: '2026-11-05T10:00:00Z' },
      { jobUrl: 'https://x/2' },
      { publishedAt: '2026-11-05T10:00:00Z' },
    ]);
    expect(result.items.map((i) => i.id)).toEqual(['1', 'https://x/2']);
    expect(result.withoutId).toBe(1);
  });
});

describe('classifyRun', () => {
  it('treats SUCCEEDED as ok', () => {
    expect(classifyRun({ status: 'SUCCEEDED' })).toEqual({
      ok: true,
      memoryFailure: false,
      chargeCapped: false,
    });
  });

  it('flags only memory style failures as memory failures', () => {
    expect(
      classifyRun({
        status: 'FAILED',
        statusMessage: 'Actor ran out of memory',
      }).memoryFailure,
    ).toBe(true);
    expect(classifyRun({ status: 'FAILED', exitCode: 137 }).memoryFailure).toBe(
      true,
    );
    expect(
      classifyRun({ status: 'FAILED', statusMessage: 'Selector not found' })
        .memoryFailure,
    ).toBe(false);
    expect(classifyRun({ status: 'TIMED-OUT' }).memoryFailure).toBe(false);
  });

  it('does not take any mention of memory for a memory failure', () => {
    for (const statusMessage of [
      'Finished. Peak memory usage 412 MB',
      'Low memory mode: scraping one page at a time',
      'Charged for memory: 1 GB',
    ])
      expect(
        classifyRun({ status: 'FAILED', statusMessage }).memoryFailure,
      ).toBe(false);
  });

  it('reads a thrown error message too', () => {
    expect(classifyRun({ error: 'Container OOM killed' }).memoryFailure).toBe(
      true,
    );
    expect(
      classifyRun({ error: 'FATAL ERROR: JavaScript heap out of memory' })
        .memoryFailure,
    ).toBe(true);
  });

  it('flags a charge-cap stop from the run usage reaching its cap', () => {
    expect(
      classifyRun({
        status: 'SUCCEEDED',
        usageTotalUsd: 0.0399,
        maxTotalChargeUsd: 0.04,
      }).chargeCapped,
    ).toBe(true);
    expect(
      classifyRun({
        status: 'SUCCEEDED',
        usageTotalUsd: 0.02,
        maxTotalChargeUsd: 0.04,
      }).chargeCapped,
    ).toBe(false);
  });

  it('flags the charge-limit status message, and nothing looser', () => {
    expect(
      classifyRun({
        status: 'ABORTED',
        statusMessage: 'Run stopped: maximum total charge reached',
      }),
    ).toEqual({ ok: false, memoryFailure: false, chargeCapped: true });
    for (const statusMessage of [
      'Max results reached',
      'Cost per job: $0.0007, limit of 50 rows reached',
    ])
      expect(
        classifyRun({ status: 'SUCCEEDED', statusMessage }).chargeCapped,
      ).toBe(false);
  });
});

describe('planSpend', () => {
  it('counts what each chosen section reserves and how many pairs fit', () => {
    const plan = planSpend({
      sections: new Set(['or', 'length', 'containment'] as const),
      pairCount: 40,
      limitUsd: 1,
    });
    expect(plan.reservedUsd.or).toBeCloseTo(5 * rowsCap(25));
    expect(plan.reservedUsd.length).toBeCloseTo(4 * rowsCap(25));
    expect(plan.reservedUsd.ceiling).toBe(0);
    expect(plan.containmentPairsAffordable).toBeGreaterThan(0);
    expect(plan.warnings.join(' ')).toMatch(/of 40 pairs/);
  });

  it('warns plainly when the ceiling cannot fit beside the other sections', () => {
    const plan = planSpend({
      sections: new Set(['or', 'length', 'containment', 'ceiling'] as const),
      pairCount: 10,
      limitUsd: 1,
    });
    expect(plan.containmentPairsAffordable).toBe(0);
    expect(plan.warnings.join(' ')).toMatch(/ceiling.*does not fit/i);
    expect(plan.warnings.join(' ')).toMatch(/no containment pair fits/i);
  });

  it('has no warnings for the ceiling on its own', () => {
    const plan = planSpend({
      sections: new Set(['ceiling'] as const),
      pairCount: 10,
      limitUsd: 1,
    });
    expect(plan.warnings).toEqual([]);
  });
});

describe('invocationLimit', () => {
  it('is the per-run budget while the campaign has room', () => {
    expect(invocationLimit(0)).toBe(TOTAL_BUDGET_USD);
    expect(CAMPAIGN_BUDGET_USD).toBe(2);
  });

  it('shrinks to what the campaign has left, never below zero', () => {
    expect(invocationLimit(1.5)).toBeCloseTo(0.5);
    expect(invocationLimit(2.5)).toBe(0);
  });
});

describe('rowsCap', () => {
  it('covers the start fee plus the worst per-row price with headroom', () => {
    // Free plan: $0.0007 per row, $0.005 start fee at 1 GB.
    expect(rowsCap(25)).toBeGreaterThan(0.005 + 25 * 0.0007);
    expect(rowsCap(1200)).toBeGreaterThan(0.005 + 1200 * 0.0007);
  });

  it('keeps a 1200 row run under the whole budget on its own', () => {
    expect(rowsCap(1200)).toBeLessThan(TOTAL_BUDGET_USD);
  });
});
