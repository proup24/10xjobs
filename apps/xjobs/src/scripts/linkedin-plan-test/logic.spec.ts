import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';
import {
  TOTAL_BUDGET_USD,
  BudgetExceededError,
  buildPairs,
  classifyRun,
  createBudget,
  containmentVerdict,
  datedItems,
  judgeContainment,
  orderPairs,
  parseGeoArgs,
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

  it('passes when the parent holds every child job', () => {
    const result = containmentVerdict(
      [{ id: 'a', publishedAt: at(5) }],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(4) },
      ],
    );
    expect(result).toEqual({ verdict: 'pass', missing: [] });
  });

  it('is a row-limit cut when every missing job is older than the parent oldest', () => {
    const result = containmentVerdict(
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'old', publishedAt: at(1) },
      ],
      [
        { id: 'a', publishedAt: at(5) },
        { id: 'b', publishedAt: at(3) },
      ],
    );
    expect(result).toEqual({ verdict: 'row-limit-cut', missing: ['old'] });
  });

  it('fails when a missing job is newer than the parent oldest', () => {
    const result = containmentVerdict(
      [{ id: 'new', publishedAt: at(6) }],
      [{ id: 'b', publishedAt: at(3) }],
    );
    expect(result).toEqual({ verdict: 'fail', missing: ['new'] });
  });

  it('fails when a missing job has no usable date', () => {
    const result = containmentVerdict(
      [{ id: 'x', publishedAt: null }],
      [{ id: 'b', publishedAt: at(3) }],
    );
    expect(result.verdict).toBe('fail');
  });

  it('fails when the parent is empty and the child is not', () => {
    expect(
      containmentVerdict([{ id: 'x', publishedAt: at(2) }], []).verdict,
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

describe('buildPairs and orderPairs', () => {
  const geography = {
    regions: [
      { code: 'EMEA', label: 'EMEA' },
      { code: 'EU', label: 'Europe' },
    ],
    countries: [
      { code: 'DE', label: 'Germany' },
      { code: 'MA', label: 'Morocco' },
    ],
    cities: [{ name: 'Casablanca', countryCode: 'MA' }],
    links: [
      { regionCode: 'EMEA', countryCode: 'DE' },
      { regionCode: 'EMEA', countryCode: 'MA' },
      { regionCode: 'EU', countryCode: 'DE' },
    ],
  };

  it('pairs a country with its regions and the fixed parents, once each', () => {
    const pairs = buildPairs(['germany'], geography);
    const keys = pairs.map((p) => `${p.child}>${p.parent}`);
    expect(keys).toContain('germany>EMEA');
    expect(keys).toContain('germany>Europe');
    expect(keys).toContain('germany>LATAM');
    expect(keys).toContain('germany>North Africa');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pairs a city with its country as well', () => {
    const keys = buildPairs(['casablanca, morocco'], geography).map(
      (p) => `${p.child}>${p.parent}`,
    );
    expect(keys).toContain('casablanca, morocco>Morocco');
    expect(keys).toContain('casablanca, morocco>EMEA');
  });

  it('skips regions and places it cannot place', () => {
    expect(buildPairs(['emea', 'atlantis'], geography)).toEqual([]);
  });

  it('orders fixed parents first with EMEA first, keeping the rest after', () => {
    const ordered = orderPairs([
      { child: 'germany', parent: 'Morocco' },
      { child: 'germany', parent: 'LATAM' },
      { child: 'germany', parent: 'Europe' },
      { child: 'germany', parent: 'EMEA' },
      { child: 'morocco', parent: 'North Africa' },
    ]);
    expect(ordered.map((p) => p.parent)).toEqual([
      'EMEA',
      'Europe',
      'LATAM',
      'North Africa',
      'Morocco',
    ]);
  });
});

describe('judgeContainment', () => {
  const good = {
    ok: true,
    items: [{ id: 'a', publishedAt: '2026-11-05T10:00:00Z' }],
  };

  it('is invalid when the child run failed or came back empty', () => {
    expect(
      judgeContainment({ ok: false, items: good.items }, good).verdict,
    ).toBe('invalid');
    expect(judgeContainment({ ok: true, items: [] }, good).verdict).toBe(
      'invalid',
    );
  });

  it('is invalid, not fail, when the parent run failed', () => {
    expect(judgeContainment(good, { ok: false, items: [] }).verdict).toBe(
      'invalid',
    );
  });

  it('otherwise defers to the containment verdict', () => {
    expect(judgeContainment(good, good)).toEqual({
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

  it('flags a charge-cap stop on its own', () => {
    const result = classifyRun({
      status: 'ABORTED',
      statusMessage: 'Run stopped: maximum total charge reached',
    });
    expect(result).toEqual({
      ok: false,
      memoryFailure: false,
      chargeCapped: true,
    });
  });

  it('reads a thrown error message too', () => {
    expect(classifyRun({ error: 'Container OOM killed' }).memoryFailure).toBe(
      true,
    );
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
