import {
  ACTOR_BY_CHANNEL,
  buildActorReport,
  coverage,
  formatActorReport,
  moroccoDay,
  runActor,
  tickOf,
  type BuilderRow,
  type JobOutcome,
  type RunRow,
  type Sighting,
} from './report';
import { atCeiling } from './queries';

const H = 'harvestapi/linkedin-job-search';
const C = 'cheap_scraper/linkedin-job-scraper';
const B = 'bebity/linkedin-jobs-scraper';
const HC = 'LINKEDIN_JOB_BOARD';
const CC = 'LINKEDIN_JOB_BOARD_CHEAP';
const BC = 'LINKEDIN_JOB_BOARD_BEBITY';
const CHANNEL_OF: Record<string, string> = { [H]: HC, [C]: CC, [B]: BC };
const AT = '2026-11-18T10:00:00Z';

function sighting(
  jobId: string,
  runId: string,
  at: string,
  extra: Partial<Sighting> = {},
): Sighting {
  return {
    jobId,
    runId,
    actor: ACTOR_OF_RUN[runId[0]] ?? H,
    seenAt: new Date(at),
    filterWorkType: null,
    itemWorkplaceType: null,
    ...extra,
  };
}

/** Run ids start with the actor's letter: h…, c…, b…. */
const ACTOR_OF_RUN: Record<string, string> = { h: H, c: C, b: B };

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

function run(runId: string, extra: Partial<RunRow> = {}): RunRow {
  const actor = extra.actor ?? ACTOR_OF_RUN[runId[0]] ?? H;
  return {
    runId,
    actor,
    channel: CHANNEL_OF[actor],
    startedAt: new Date(AT),
    status: 'succeeded',
    capped: false,
    costMicroUsd: 100_000,
    queryIds: [`${runId}-q`],
    truncatedQueryIds: [],
    atCeiling: false,
    rows: 10,
    sentKeyword: actor === C ? 'react' : null,
    echoedKeywords: actor === C ? ['react'] : [],
    ...extra,
  };
}

function builder(
  id: string,
  channel: string,
  group: string,
  extra: Partial<BuilderRow> = {},
): BuilderRow {
  return {
    id,
    channel,
    group,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    activeUntil: null,
    ...extra,
  };
}

/** One group G that each actor ran in one tick: runs h, c, b; builders h-q, c-q, b-q. */
const allRan = {
  runs: [run('h'), run('c'), run('b')],
  builders: [
    builder('h-q', HC, 'G'),
    builder('c-q', CC, 'G'),
    builder('b-q', BC, 'G'),
  ],
};

function report(
  sightings: Sighting[],
  outcomes: JobOutcome[] = [],
  world: { runs: RunRow[]; builders: BuilderRow[] } = allRan,
) {
  return buildActorReport(sightings, outcomes, world.runs, world.builders);
}

const HC_PAIR = 'harvestapi–cheap_scraper';

/** Morocco's UTC offset in minutes at that instant, from the runtime's tz data. */
function casablancaOffset(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Casablanca',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name ?? '');
  if (!m) throw new Error(`unexpected offset name ${name}`);
  return m[1]
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
    : 0;
}

/**
 * The calendar day (or hour) in Africa/Casablanca. Morocco's offset (UTC+0 or
 * UTC+1) depends on the runtime's tz data, so the tests must not hard-code it.
 */
function casablanca(iso: string, length: 10 | 13): string {
  const at = new Date(iso);
  return new Date(at.getTime() + casablancaOffset(at) * 60_000)
    .toISOString()
    .slice(0, length);
}

describe('moroccoDay', () => {
  it('uses the Morocco calendar day, not the UTC one', () => {
    for (const iso of [
      '2026-11-18T23:30:00Z',
      '2026-11-18T22:30:00Z',
      '2026-11-19T00:30:00Z',
      '2026-03-01T23:30:00Z',
    ]) {
      expect(moroccoDay(new Date(iso))).toBe(casablanca(iso, 10));
    }
  });

  it('keeps midday on the same day', () => {
    expect(moroccoDay(new Date('2026-11-18T12:00:00Z'))).toBe('2026-11-18');
  });
});

describe('tickOf', () => {
  it('gives one tick per Morocco hour', () => {
    const hourStart = new Date(
      new Date('2026-11-18T10:30:00Z').getTime() -
        ((casablancaOffset(new Date('2026-11-18T10:30:00Z')) + 30) % 60) *
          60_000,
    );
    const at40 = new Date(hourStart.getTime() + 40 * 60_000);
    const next = new Date(hourStart.getTime() + 60 * 60_000);
    expect(tickOf(hourStart)).toBe(tickOf(at40));
    expect(tickOf(next)).not.toBe(tickOf(hourStart));
    for (const at of [hourStart, at40, next]) {
      expect(tickOf(at)).toBe(casablanca(at.toISOString(), 13));
    }
  });
});

describe('runActor', () => {
  it('credits a run with no batch by its channel actor', () => {
    expect(runActor(null, BC)).toBe(B);
    expect(runActor(null, CC)).toBe(C);
    expect(runActor(null, HC)).toBe(H);
    expect(runActor('someone/else', CC)).toBe('someone/else');
    expect(ACTOR_BY_CHANNEL[BC]).toBe(B);
  });

  it('counts a run with no batch in its channel actor cost and not-run rows', () => {
    const failed = run('b', { costMicroUsd: 0, status: 'failed', rows: 0 });
    const r = report([], [], {
      runs: [run('h'), failed],
      builders: [builder('h-q', HC, 'G'), builder('b-q', BC, 'G')],
    });
    const cost = r.cost.find((x) => x.label === 'total' && x.actor === B);
    expect(cost).toMatchObject({ runs: 1, costUsd: 0 });
    const notRun = r.notRun.find((x) => x.label === 'total' && x.actor === B);
    expect(notRun).toMatchObject({ notStarted: 1, ran: 0 });
  });
});

describe('atCeiling', () => {
  it('is true for a run of 1000 rows, the row limit, and false for 100', () => {
    for (const channel of [HC, CC, BC]) {
      expect(atCeiling(channel, 1000)).toBe(true);
      expect(atCeiling(channel, 100)).toBe(false);
    }
  });
});

describe('coverage', () => {
  const tick = tickOf(new Date(AT));

  it('ran a group only when every builder of it ran', () => {
    const cells = coverage(
      [run('h', { queryIds: ['h1'] }), run('c', { queryIds: ['c1'] })],
      [builder('h1', HC, 'G'), builder('h2', HC, 'G'), builder('c1', CC, 'G')],
    );
    expect(cells.get(H)?.get(`G|${tick}`)).toBe('skipped');
    expect(cells.get(C)?.get(`G|${tick}`)).toBe('ran');
  });

  it('counts a group as ran when same-tick splits cover its builders', () => {
    const later = new Date(new Date(AT).getTime() + 20 * 60_000);
    const cells = coverage(
      [
        run('h1', { queryIds: ['h1'] }),
        run('h2', { queryIds: ['h2'], startedAt: later }),
      ],
      [builder('h1', HC, 'G'), builder('h2', HC, 'G')],
    );
    expect(cells.get(H)?.get(`G|${tick}`)).toBe('ran');
  });

  describe('a full run held for splitting', () => {
    const later = new Date(new Date(AT).getTime() + 10 * 60_000);
    const full = run('h0', {
      queryIds: ['h1', 'h2'],
      truncatedQueryIds: ['h1', 'h2'],
      rows: 100,
    });
    // cheap_scraper ran G in the tick, so harvestapi's status is kept.
    const cheap = run('c', { queryIds: ['c1'] });
    const members = [
      builder('h1', HC, 'G'),
      builder('h2', HC, 'G'),
      builder('c1', CC, 'G'),
    ];

    it('is skipped when the cap skips its halves', () => {
      const cells = coverage([full, cheap], members);
      expect(cells.get(H)?.get(`G|${tick}`)).toBe('skipped');
    });

    it('takes a failed half as the reason', () => {
      const cells = coverage(
        [
          full,
          run('h1', { queryIds: ['h1'], startedAt: later }),
          run('h2', {
            queryIds: ['h2'],
            startedAt: later,
            status: 'failed',
            costMicroUsd: null,
          }),
          cheap,
        ],
        members,
      );
      expect(cells.get(H)?.get(`G|${tick}`)).toBe('failed');
    });

    it('ran when its same-tick halves both succeeded, with every run its jobs', () => {
      const runs = [
        full,
        run('h1', { queryIds: ['h1'], startedAt: later }),
        run('h2', { queryIds: ['h2'], startedAt: later }),
        run('c', { queryIds: ['c1'] }),
      ];
      const world = { runs, builders: members };
      expect(coverage(runs, world.builders).get(H)?.get(`G|${tick}`)).toBe(
        'ran',
      );
      const r = report(
        [sighting('x', 'h0', AT), sighting('x', 'c', AT)],
        [],
        world,
      );
      expect(
        r.pairs.find((p) => p.label === 'total' && p.a === H && p.b === C),
      ).toMatchObject({ both: 1 });
    });

    it('ran when full at the ceiling alone', () => {
      const ceiling = run('h0', {
        queryIds: ['h1'],
        truncatedQueryIds: ['h1'],
        rows: 1000,
        atCeiling: true,
      });
      const cells = coverage([ceiling], [builder('h1', HC, 'G')]);
      expect(cells.get(H)?.get(`G|${tick}`)).toBe('ran');
    });
  });

  describe('builder history', () => {
    const hour = 3_600_000;
    const t1 = new Date(AT);
    const t2 = new Date(t1.getTime() + 2 * hour);
    const t3 = new Date(t1.getTime() + 4 * hour);

    it('does not require a builder created after an earlier tick', () => {
      const cells = coverage(
        [
          run('h1', { queryIds: ['h1'], startedAt: t1 }),
          run('c1', { queryIds: ['c1'], startedAt: t1 }),
          run('h2', { queryIds: ['h1', 'h2'], startedAt: t2 }),
          run('c2', { queryIds: ['c1', 'c2'], startedAt: t2 }),
        ],
        [
          builder('h1', HC, 'G'),
          builder('c1', CC, 'G'),
          builder('h2', HC, 'G', { createdAt: new Date(t1.getTime() + hour) }),
          builder('c2', CC, 'G', { createdAt: new Date(t1.getTime() + hour) }),
        ],
      );
      for (const actor of [H, C]) {
        expect(cells.get(actor)?.get(`G|${tickOf(t1)}`)).toBe('ran');
        expect(cells.get(actor)?.get(`G|${tickOf(t2)}`)).toBe('ran');
      }
    });

    it('requires a builder deactivated later in the ticks while it was active', () => {
      const retired = builder('h2', HC, 'G', {
        activeUntil: new Date(t2.getTime() + hour),
      });
      const cells = coverage(
        [
          run('h1', { queryIds: ['h1'], startedAt: t1 }),
          run('h1b', { queryIds: ['h1'], startedAt: t3 }),
          run('c1', { queryIds: ['c1'], startedAt: t1 }),
          run('c3', { queryIds: ['c1'], startedAt: t3 }),
        ],
        [builder('h1', HC, 'G'), retired, builder('c1', CC, 'G')],
      );
      // h2 was active at t1 but not in its run: harvestapi didn't run G then.
      expect(cells.get(H)?.get(`G|${tickOf(t1)}`)).toBe('skipped');
      // Retired before t3: h1 alone covers G.
      expect(cells.get(H)?.get(`G|${tickOf(t3)}`)).toBe('ran');
    });
  });

  it('labels not-run reasons', () => {
    const groups = ['skip', 'start', 'fail', 'cap'];
    const cells = coverage(
      [
        ...groups.map((g) => run(`h-${g}`, { queryIds: [`h-${g}`] })),
        run('b-start', {
          queryIds: ['b-start'],
          status: 'failed',
          costMicroUsd: 0,
        }),
        run('b-fail', {
          queryIds: ['b-fail'],
          status: 'failed',
          costMicroUsd: null,
        }),
        run('b-cap', { queryIds: ['b-cap'], capped: true }),
      ],
      groups.flatMap((g) => [
        builder(`h-${g}`, HC, g),
        builder(`b-${g}`, BC, g),
      ]),
    );
    const bebity = cells.get(B);
    expect(bebity?.get(`skip|${tick}`)).toBe('skipped');
    expect(bebity?.get(`start|${tick}`)).toBe('not started');
    expect(bebity?.get(`fail|${tick}`)).toBe('failed');
    expect(bebity?.get(`cap|${tick}`)).toBe('capped');
  });

  it('does not credit a channel actor with another batch actor run on its channel', () => {
    const cells = coverage(
      [
        run('c0', {
          startedAt: new Date(new Date(AT).getTime() - 3_600_000),
        }),
        run('h'),
        run('c', { actor: 'old/trial-actor', channel: CC }),
      ],
      allRan.builders.slice(0, 2),
    );
    expect(cells.get(C)?.get(`G|${tick}`)).toBe('skipped');
  });

  it('does not count ticks before the actor first ran', () => {
    const earlier = new Date(new Date(AT).getTime() - 3 * 3_600_000);
    const cells = coverage(
      [run('h0', { queryIds: ['h-q'], startedAt: earlier }), ...allRan.runs],
      allRan.builders,
    );
    expect(cells.get(B)?.has(`G|${tickOf(earlier)}`)).toBe(false);
    expect(cells.get(H)?.get(`G|${tickOf(earlier)}`)).toBe('ran');
  });
});

describe('pairs', () => {
  it('excludes groups an actor did not run from that pair', () => {
    // bebity's cap stopped it before G2: G2 counts for harvestapi–cheap only.
    const world = {
      runs: [
        run('h1', { queryIds: ['h1'] }),
        run('h2', { queryIds: ['h2'] }),
        run('c1', { queryIds: ['c1'] }),
        run('c2', { queryIds: ['c2'] }),
        run('b1', { queryIds: ['b1'] }),
      ],
      builders: [
        builder('h1', HC, 'G1'),
        builder('h2', HC, 'G2'),
        builder('c1', CC, 'G1'),
        builder('c2', CC, 'G2'),
        builder('b1', BC, 'G1'),
        builder('b2', BC, 'G2'),
      ],
    };
    const r = report(
      [
        sighting('g1', 'h1', AT),
        sighting('g1', 'b1', AT),
        sighting('g2', 'h2', AT),
        sighting('g2', 'c2', AT),
      ],
      [],
      world,
    );
    const pair = (a: string, b: string) =>
      r.pairs.find((p) => p.label === 'total' && p.a === a && p.b === b);
    expect(pair(H, B)).toMatchObject({ aOnly: 0, bOnly: 0, both: 1 });
    expect(pair(H, C)).toMatchObject({ aOnly: 1, bOnly: 0, both: 1 });
    expect(pair(C, B)).toMatchObject({ aOnly: 0, bOnly: 1, both: 0 });
    expect(
      r.notRun.find((x) => x.label === 'total' && x.actor === B),
    ).toMatchObject({ ran: 1, skipped: 1 });
  });

  it('counts A only, B only and both per pair, with who saw first and the median lead', () => {
    const r = report([
      sighting('a', 'h', '2026-11-18T10:00:00Z'),
      sighting('a', 'c', '2026-11-18T10:02:00Z'),
      sighting('b', 'h', '2026-11-18T10:05:00Z'),
      sighting('b', 'c', '2026-11-18T10:00:00Z'),
      sighting('c', 'h', '2026-11-18T10:00:00Z'),
      sighting('c', 'c', '2026-11-18T10:10:00Z'),
      sighting('d', 'h', '2026-11-18T10:00:00Z'),
      sighting('e', 'c', '2026-11-18T10:00:00Z'),
      sighting('f', 'c', '2026-11-18T10:00:00Z'),
    ]);
    const total = r.pairs.find(
      (p) => p.label === 'total' && p.a === H && p.b === C,
    );
    expect(total).toEqual({
      label: 'total',
      a: H,
      b: C,
      aOnly: 1,
      bOnly: 2,
      both: 3,
      aFirst: 2,
      bFirst: 1,
      medianLeadMinutes: 2,
    });
  });

  it('places a job on the Morocco day it was first seen in the pair', () => {
    const at = '2026-11-18T23:30:00Z';
    const r = report([sighting('a', 'h', at)], [], {
      runs: [
        run('h', { startedAt: new Date(at) }),
        run('c', { startedAt: new Date(at) }),
      ],
      builders: allRan.builders.slice(0, 2),
    });
    expect(
      r.pairs.filter((p) => p.a === H && p.b === C).map((p) => p.label),
    ).toEqual([casablanca(at, 10), 'total']);
  });
});

describe('three-way', () => {
  it('counts jobs seen by one, two or three actors on groups all three ran', () => {
    const world = {
      runs: [...allRan.runs, run('h2', { queryIds: ['h2'] })],
      builders: [...allRan.builders, builder('h2', HC, 'G2')],
    };
    const r = report(
      [
        sighting('x', 'h', AT),
        sighting('x', 'c', AT),
        sighting('x', 'b', AT),
        sighting('y', 'h', AT),
        sighting('y', 'b', AT),
        sighting('z', 'c', AT),
        sighting('w', 'h2', AT),
      ],
      [],
      world,
    );
    expect(r.threeWay.find((x) => x.label === 'total')).toEqual({
      label: 'total',
      one: 1,
      two: 1,
      three: 1,
    });
  });
});

describe('outcomes per pair', () => {
  it('credits an applied cheap-only job to cheap_scraper only', () => {
    const r = report(
      [sighting('a', 'c', AT), sighting('b', 'h', AT)],
      [outcome('a', { outcome: 'qualified', applied: 1 }), outcome('b')],
    );
    const row = r.outcomes.find(
      (x) =>
        x.label === 'total' &&
        x.pair === HC_PAIR &&
        x.group === 'cheap_scraper only',
    );
    expect(row).toMatchObject({ jobs: 1, qualified: 1, applied: 1 });
  });
});

describe('rejections and coverage per pair group', () => {
  const sightings = [
    sighting('a', 'h', AT),
    sighting('b', 'h', AT),
    sighting('c', 'c', AT),
    sighting('d', 'h', AT),
    sighting('d', 'c', '2026-11-18T10:01:00Z'),
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
  const r = report(sightings, outcomes);

  it('counts rejected jobs by first failing rule per pair group', () => {
    const rows = r.rejections.filter(
      (x) => x.label === 'total' && x.pair === HC_PAIR,
    );
    expect(rows).toEqual([
      {
        label: 'total',
        pair: HC_PAIR,
        group: 'harvestapi only',
        rule: 'location',
        jobs: 2,
      },
      {
        label: 'total',
        pair: HC_PAIR,
        group: 'cheap_scraper only',
        rule: 'seniority',
        jobs: 1,
      },
    ]);
    expect(formatActorReport(r)).toContain('Rejections by first failing rule');
  });

  it('counts rejected jobs by first failing rule per actor', () => {
    expect(
      r.actorRejections.filter((x) => x.label === 'total' && x.actor === H),
    ).toEqual([{ label: 'total', actor: H, rule: 'location', jobs: 2 }]);
  });

  it('reports field coverage per pair group', () => {
    const row = (g: string) =>
      r.groupCoverage.find(
        (x) => x.label === 'total' && x.pair === HC_PAIR && x.group === g,
      );
    expect(row('both')).toMatchObject({
      jobs: 1,
      workplaceType: 1,
      salary: 1,
      place: 0,
    });
    expect(row('cheap_scraper only')).toMatchObject({
      jobs: 1,
      place: 1,
      workplaceType: 0,
    });
    expect(row('harvestapi only')).toMatchObject({ jobs: 2, place: 0 });
  });
});

describe('cost', () => {
  it('divides cost by qualified jobs, and shows a dash when none', () => {
    const r = report(
      [sighting('a', 'c', AT), sighting('b', 'h', AT)],
      [outcome('a', { outcome: 'qualified' }), outcome('b')],
      {
        runs: [run('c'), run('h', { costMicroUsd: 50_000 })],
        builders: allRan.builders,
      },
    );
    const cheap = r.cost.find((x) => x.label === 'total' && x.actor === C);
    expect(cheap?.costPerQualifiedUsd).toBeCloseTo(0.1);
    const harvest = r.cost.find((x) => x.label === 'total' && x.actor === H);
    expect(harvest?.costPerQualifiedUsd).toBeNull();
    expect(formatActorReport(r)).toContain('—');
  });

  it('counts runs with no recorded cost apart', () => {
    const r = report([], [], {
      runs: [run('b', { status: 'failed', costMicroUsd: null })],
      builders: [],
    });
    expect(
      r.cost.find((x) => x.label === 'total' && x.actor === B),
    ).toMatchObject({ runs: 1, noCost: 1, costUsd: 0 });
  });
});

describe('AI search', () => {
  it('counts contradicting filters and rewritten keywords; bebity is n/a', () => {
    const r = report(
      [
        sighting('a', 'h', AT, {
          filterWorkType: '2',
          itemWorkplaceType: 'onsite',
        }),
        sighting('b', 'h', AT, {
          filterWorkType: '2',
          itemWorkplaceType: null,
        }),
        sighting('c', 'h', AT, {
          filterWorkType: '2',
          itemWorkplaceType: 'remote',
        }),
      ],
      [],
      {
        runs: [
          run('c1', { echoedKeywords: ['java developer'] }),
          run('c2'),
          run('b'),
        ],
        builders: [],
      },
    );
    const row = (actor: string) =>
      r.aiSearch.find((x) => x.label === 'total' && x.actor === actor);
    expect(row(H)).toMatchObject({ checked: 3, flagged: 1 });
    expect(row(C)).toMatchObject({ checked: 2, flagged: 1 });
    expect(row(B)).toMatchObject({ checked: null, flagged: null });
    expect(formatActorReport(r)).toContain('n/a');
  });
});

describe('joined', () => {
  it('splits joined jobs into reused and ran Claude', () => {
    const r = report(
      [sighting('a', 'h', AT), sighting('b', 'h', AT)],
      [
        outcome('a', { joined: true, joinedReused: true }),
        outcome('b', { joined: true, joinedReused: false }),
      ],
    );
    expect(r.joined.find((x) => x.label === 'total')).toMatchObject({
      joined: 2,
      reused: 1,
      ranClaude: 1,
    });
  });
});

describe('formatActorReport', () => {
  it('prints a header per section and a total row, even when empty', () => {
    const text = formatActorReport(buildActorReport([], [], [], []));
    for (const h of [
      'Overlap per pair',
      'Not run',
      'All three',
      'Outcomes',
      'Cost per qualified job',
      'Coverage',
      'AI search',
      'Joined jobs',
    ]) {
      expect(text).toContain(h);
    }
    expect(text).toContain('total');
    expect(text).toContain(HC_PAIR);
  });
});
