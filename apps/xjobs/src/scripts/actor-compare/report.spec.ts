import {
  buildActorReport,
  formatActorReport,
  moroccoDay,
  type JobOutcome,
  type RunRow,
  type Sighting,
} from './report';

const H = 'harvestapi/linkedin-job-search';
const T = 'cheap_scraper/linkedin-job-scraper';

function sighting(
  jobId: string,
  actor: string,
  at: string,
  extra: Partial<Sighting> = {},
): Sighting {
  return {
    jobId,
    actor,
    seenAt: new Date(at),
    filterWorkType: null,
    itemWorkplaceType: null,
    ...extra,
  };
}

function outcome(jobId: string, extra: Partial<JobOutcome> = {}): JobOutcome {
  return {
    jobId,
    outcome: null,
    firstFailRule: null,
    applied: 0,
    dismissed: 0,
    workplaceType: false,
    place: false,
    salary: false,
    applyLink: false,
    joined: false,
    joinedReused: null,
    ...extra,
  };
}

function run(extra: Partial<RunRow> = {}): RunRow {
  return {
    actor: T,
    startedAt: new Date('2026-11-18T10:00:00Z'),
    rows: 10,
    costMicroUsd: 100_000,
    sentKeyword: 'react',
    echoedKeywords: ['react'],
    ...extra,
  };
}

/**
 * The calendar day in Africa/Casablanca, computed from the zone's offset at that
 * instant. Morocco's offset (UTC+0 or UTC+1) depends on the runtime's tz data,
 * so the tests must not hard-code it.
 */
function casablancaDay(iso: string): string {
  const at = new Date(iso);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Casablanca',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name ?? '');
  if (!m) throw new Error(`unexpected offset name ${name}`);
  const minutes = m[1]
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
    : 0;
  return new Date(at.getTime() + minutes * 60_000).toISOString().slice(0, 10);
}

describe('moroccoDay', () => {
  it('uses the Morocco calendar day, not the UTC one', () => {
    for (const iso of [
      '2026-11-18T23:30:00Z',
      '2026-11-18T22:30:00Z',
      '2026-11-19T00:30:00Z',
      '2026-03-01T23:30:00Z',
    ]) {
      expect(moroccoDay(new Date(iso))).toBe(casablancaDay(iso));
    }
  });

  it('keeps midday on the same day', () => {
    expect(moroccoDay(new Date('2026-11-18T12:00:00Z'))).toBe('2026-11-18');
  });
});

describe('overlap', () => {
  it('counts shared jobs in both, and the median lead', () => {
    const sightings = [
      sighting('a', H, '2026-11-18T10:00:00Z'),
      sighting('a', T, '2026-11-18T10:02:00Z'),
      sighting('b', H, '2026-11-18T10:00:00Z'),
      sighting('b', T, '2026-11-18T10:05:00Z'),
      sighting('c', H, '2026-11-18T10:00:00Z'),
      sighting('c', T, '2026-11-18T10:10:00Z'),
      sighting('d', H, '2026-11-18T10:00:00Z'),
      sighting('e', T, '2026-11-18T10:00:00Z'),
    ];
    const total = buildActorReport(sightings, [], []).overlap.find(
      (r) => r.label === 'total',
    );
    expect(total).toMatchObject({
      harvest: 4,
      trial: 4,
      both: 3,
      harvestOnly: 1,
      trialOnly: 1,
      harvestFirst: 3,
      trialFirst: 0,
      medianLeadMinutes: 5,
    });
  });

  it('counts who saw shared jobs first', () => {
    const total = buildActorReport(
      [
        sighting('a', H, '2026-11-18T10:00:00Z'),
        sighting('a', T, '2026-11-18T10:03:00Z'),
        sighting('b', T, '2026-11-18T10:00:00Z'),
        sighting('b', H, '2026-11-18T10:04:00Z'),
        sighting('c', T, '2026-11-18T10:00:00Z'),
        sighting('c', H, '2026-11-18T10:06:00Z'),
      ],
      [],
      [],
    ).overlap.find((r) => r.label === 'total');
    expect(total).toMatchObject({ harvestFirst: 1, trialFirst: 2 });
  });

  it('groups by Morocco day', () => {
    const report = buildActorReport(
      [sighting('a', H, '2026-11-18T23:30:00Z')],
      [],
      [],
    );
    expect(report.overlap.map((r) => r.label)).toEqual([
      casablancaDay('2026-11-18T23:30:00Z'),
      'total',
    ]);
  });
});

describe('outcomes', () => {
  it('credits an applied trial-only job to trial only', () => {
    const report = buildActorReport(
      [
        sighting('a', T, '2026-11-18T10:00:00Z'),
        sighting('b', H, '2026-11-18T10:00:00Z'),
      ],
      [outcome('a', { outcome: 'qualified', applied: 1 }), outcome('b')],
      [],
    );
    const row = report.outcomes.find(
      (r) => r.label === 'total' && r.group === 'trial only',
    );
    expect(row).toMatchObject({ jobs: 1, qualified: 1, applied: 1 });
  });
});

describe('rejections and coverage by group', () => {
  const sightings = [
    sighting('a', H, '2026-11-18T10:00:00Z'),
    sighting('b', H, '2026-11-18T10:00:00Z'),
    sighting('c', T, '2026-11-18T10:00:00Z'),
    sighting('d', H, '2026-11-18T10:00:00Z'),
    sighting('d', T, '2026-11-18T10:01:00Z'),
  ];
  const outcomes = [
    outcome('a', { outcome: 'rejected', firstFailRule: 'location' }),
    outcome('b', { outcome: 'rejected', firstFailRule: 'location' }),
    outcome('c', {
      outcome: 'rejected',
      firstFailRule: 'seniority',
      place: true,
    }),
    outcome('d', { outcome: 'qualified', workplaceType: true, salary: true }),
  ];
  const report = buildActorReport(sightings, outcomes, []);

  it('counts rejected jobs by first failing rule per group', () => {
    const rows = report.rejections.filter((r) => r.label === 'total');
    expect(rows).toEqual([
      { label: 'total', group: 'harvest only', rule: 'location', jobs: 2 },
      { label: 'total', group: 'trial only', rule: 'seniority', jobs: 1 },
    ]);
    expect(formatActorReport(report)).toContain(
      'Rejections by first failing rule',
    );
  });

  it('reports field coverage per group', () => {
    const row = (g: string) =>
      report.groupCoverage.find((r) => r.label === 'total' && r.group === g);
    expect(row('both')).toMatchObject({
      jobs: 1,
      workplaceType: 1,
      salary: 1,
      place: 0,
    });
    expect(row('trial only')).toMatchObject({
      jobs: 1,
      place: 1,
      workplaceType: 0,
    });
    expect(row('harvest only')).toMatchObject({ jobs: 2, place: 0 });
  });
});

describe('cost', () => {
  it('divides cost by qualified jobs, and shows a dash when none', () => {
    const sightings = [
      sighting('a', T, '2026-11-18T10:00:00Z'),
      sighting('b', H, '2026-11-18T10:00:00Z'),
    ];
    const report = buildActorReport(
      sightings,
      [outcome('a', { outcome: 'qualified' }), outcome('b')],
      [run(), run({ actor: H, costMicroUsd: 50_000 })],
    );
    const trial = report.cost.find((r) => r.label === 'total' && r.actor === T);
    expect(trial?.costPerQualifiedUsd).toBeCloseTo(0.1);
    const harvest = report.cost.find(
      (r) => r.label === 'total' && r.actor === H,
    );
    expect(harvest?.costPerQualifiedUsd).toBeNull();
    expect(formatActorReport(report)).toContain('—');
  });
});

describe('AI search', () => {
  it('counts contradicting filters and rewritten keywords', () => {
    const report = buildActorReport(
      [
        sighting('a', H, '2026-11-18T10:00:00Z', {
          filterWorkType: '2',
          itemWorkplaceType: 'onsite',
        }),
        sighting('b', H, '2026-11-18T10:00:00Z', {
          filterWorkType: '2',
          itemWorkplaceType: null,
        }),
        sighting('c', H, '2026-11-18T10:00:00Z', {
          filterWorkType: '2',
          itemWorkplaceType: 'remote',
        }),
      ],
      [],
      [run({ echoedKeywords: ['java developer'] }), run()],
    );
    const total = report.aiSearch.find((r) => r.label === 'total');
    expect(total).toMatchObject({
      harvestSightings: 3,
      contradicting: 1,
      trialRuns: 2,
      rewritten: 1,
    });
  });
});

describe('joined', () => {
  it('splits joined jobs into reused and ran Claude', () => {
    const report = buildActorReport(
      [
        sighting('a', H, '2026-11-18T10:00:00Z'),
        sighting('b', H, '2026-11-18T10:00:00Z'),
      ],
      [
        outcome('a', { joined: true, joinedReused: true }),
        outcome('b', { joined: true, joinedReused: false }),
      ],
      [],
    );
    expect(report.joined.find((r) => r.label === 'total')).toMatchObject({
      joined: 2,
      reused: 1,
      ranClaude: 1,
    });
  });
});

describe('formatActorReport', () => {
  it('prints a header per section and a total row, even when empty', () => {
    const text = formatActorReport(buildActorReport([], [], []));
    for (const h of [
      'Overlap',
      'Outcomes',
      'Cost per qualified job',
      'Coverage',
      'AI search',
      'Joined jobs',
    ]) {
      expect(text).toContain(h);
    }
    expect(text).toContain('total');
  });
});
