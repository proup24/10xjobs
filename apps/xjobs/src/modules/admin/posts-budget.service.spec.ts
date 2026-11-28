import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Channel } from 'src/common/enums';
import type { EnvironmentVariables } from 'src/config';
import type { QuerySearchBuilderRow } from 'src/database';
import type { ActivityRepository } from 'src/modules/activity';
import type { QuerySearchService } from 'src/modules/queries';
import {
  longestWaitingFirst,
  moroccoDayStart,
  planSegments,
  type PostsBudgetDay,
  type PostsBudgetService,
} from 'src/modules/segments';
import type {
  PostsBudgetRepository,
  PostsBudgetRun,
} from './posts-budget.repository';
import { PostsBudgetReportService } from './posts-budget.service';

const NOW = new Date('2026-11-27T15:00:00Z');
const HOUR = 3_600_000;
const TODAY = moroccoDayStart(NOW);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
/** The start of the Morocco day `n` days before today. */
const dayBefore = (n: number): Date => {
  let start = TODAY;
  for (let i = 0; i < n; i++)
    start = moroccoDayStart(new Date(start.getTime() - 1));
  return start;
};

const run = (
  startedAt: Date,
  usd: number | null,
  over: Partial<PostsBudgetRun> = {},
): PostsBudgetRun => ({
  segmentKey: 'linkedin_posts|en|backend|remote',
  startedAt,
  finishedAt: new Date(startedAt.getTime() + 60_000),
  costMicroUsd: usd === null ? null : Math.round(usd * 1_000_000),
  full: false,
  ...over,
});

const builder = (
  id: string,
  coveredUntil: Date | null,
  over: Partial<QuerySearchBuilderRow> & { position?: string } = {},
): QuerySearchBuilderRow =>
  ({
    id,
    channel: Channel.LINKEDIN_POSTS,
    keyword: `"${id}"`,
    hash: `hash-${id}`,
    params: {
      language: 'en',
      position: over.position ?? 'backend',
      remote: true,
      keyword: `"${id}"`,
    },
    coveredUntil,
    pausedAt: null,
    ...over,
  }) as unknown as QuerySearchBuilderRow;

function setup(
  options: {
    limitUsd?: number;
    runs?: PostsBudgetRun[];
    builders?: QuerySearchBuilderRow[];
    paused?: Set<string> | Error;
    profiles?: Map<string, string[]>;
  } = {},
) {
  const limitUsd = options.limitUsd ?? 3;
  const runs = options.runs ?? [];
  const runsSince = vi.fn(async (since: Date) =>
    runs.filter((r) => r.startedAt >= since),
  );
  const profilesFor = vi.fn(
    async () => options.profiles ?? new Map<string, string[]>(),
  );
  const repository = {
    runsSince,
    profilesFor,
  } as unknown as PostsBudgetRepository;
  const spentToday = runs
    .filter((r) => r.startedAt >= TODAY)
    .reduce((sum, r) => sum + (r.costMicroUsd ?? 250_000), 0);
  const budget = {
    today: vi.fn(
      async (): Promise<PostsBudgetDay> => ({
        dayStart: TODAY,
        nextDayStart: new Date(TODAY.getTime() + 24 * HOUR),
        limitUsd,
        spentMicroUsd: spentToday,
        reached: false,
      }),
    ),
  } as unknown as PostsBudgetService;
  const listActive = vi.fn(async () => options.builders ?? []);
  const queries = { listActive } as unknown as QuerySearchService;
  const pausedBuilderIds = vi.fn(async () => {
    if (options.paused instanceof Error) throw options.paused;
    return options.paused ?? new Set<string>();
  });
  const activity = { pausedBuilderIds } as unknown as ActivityRepository;
  const config = {
    get: (key: string) => (key === 'SEARCH_PAUSE_AFTER_HOURS' ? 24 : undefined),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const service = new PostsBudgetReportService(
    repository,
    budget,
    queries,
    activity,
    config,
  );
  return { service, runsSince, listActive, pausedBuilderIds, profilesFor };
}

describe('PostsBudgetReportService days', () => {
  it('reaches the day at the run that spends the limit', async () => {
    const third = run(new Date(TODAY.getTime() + 3 * HOUR), 0.6);
    const { service } = setup({
      runs: [
        run(new Date(TODAY.getTime() + HOUR), 1.0),
        run(new Date(TODAY.getTime() + 2 * HOUR), 1.5),
        third,
      ],
    });
    const view = await service.view(NOW);
    expect(view.limitUsd).toBe(3);
    expect(view.today).toEqual({
      dayStart: TODAY.toISOString(),
      spentUsd: 3.1,
      reachedAt: third.finishedAt.toISOString(),
    });
  });

  it('reaches the day at the run that leaves less than $0.01', async () => {
    const second = run(new Date(TODAY.getTime() + 2 * HOUR), 0.995);
    const { service } = setup({
      runs: [run(new Date(TODAY.getTime() + HOUR), 2.0), second],
    });
    const view = await service.view(NOW);
    expect(view.today.spentUsd).toBe(2.995);
    expect(view.today.reachedAt).toBe(second.finishedAt.toISOString());
  });

  it('counts a run with no cost as $0.25', async () => {
    const last = run(new Date(TODAY.getTime() + 2 * HOUR), null);
    const { service } = setup({
      limitUsd: 1,
      runs: [run(new Date(TODAY.getTime() + HOUR), 0.75), last],
    });
    const view = await service.view(NOW);
    expect(view.today.spentUsd).toBe(1);
    expect(view.today.reachedAt).toBe(last.finishedAt.toISOString());
  });

  it('leaves a day not reached at null', async () => {
    const { service } = setup({
      runs: [run(new Date(TODAY.getTime() + HOUR), 1.0)],
    });
    expect((await service.view(NOW)).today).toEqual({
      dayStart: TODAY.toISOString(),
      spentUsd: 1,
      reachedAt: null,
    });
  });

  it('lists the 7 days before today, newest first, empty ones at 0', async () => {
    const reaching = run(new Date(dayBefore(2).getTime() + HOUR), 3.0);
    const { service, runsSince } = setup({
      runs: [
        run(new Date(dayBefore(7).getTime() + HOUR), 0.5),
        reaching,
        run(new Date(dayBefore(1).getTime() + 2 * HOUR), 1.25),
      ],
    });
    const view = await service.view(NOW);
    expect(runsSince).toHaveBeenCalledWith(dayBefore(7));
    expect(view.days).toEqual([
      { dayStart: dayBefore(1).toISOString(), spentUsd: 1.25, reachedAt: null },
      {
        dayStart: dayBefore(2).toISOString(),
        spentUsd: 3,
        reachedAt: reaching.finishedAt.toISOString(),
      },
      { dayStart: dayBefore(3).toISOString(), spentUsd: 0, reachedAt: null },
      { dayStart: dayBefore(4).toISOString(), spentUsd: 0, reachedAt: null },
      { dayStart: dayBefore(5).toISOString(), spentUsd: 0, reachedAt: null },
      { dayStart: dayBefore(6).toISOString(), spentUsd: 0, reachedAt: null },
      { dayStart: dayBefore(7).toISOString(), spentUsd: 0.5, reachedAt: null },
    ]);
  });

  it("judges past days against today's limit", async () => {
    const { service } = setup({
      limitUsd: 1,
      runs: [run(new Date(dayBefore(1).getTime() + HOUR), 1.0)],
    });
    expect((await service.view(NOW)).days[0]!.reachedAt).not.toBeNull();
  });
});

describe('PostsBudgetReportService searches', () => {
  const quiet = () =>
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  afterEach(() => vi.restoreAllMocks());

  it('leaves out paused builders and counts them', async () => {
    const { service, pausedBuilderIds } = setup({
      builders: [builder('a', hoursAgo(2)), builder('b', hoursAgo(3))],
      paused: new Set(['b']),
    });
    const view = await service.view(NOW);
    expect(pausedBuilderIds).toHaveBeenCalledWith(
      Channel.LINKEDIN_POSTS,
      NOW,
      24,
    );
    expect(view.pausedBuilders).toBe(1);
    expect(view.searches).toHaveLength(1);
    expect(view.searches[0]!.oldestCoveredUntil).toBe(
      hoursAgo(2).toISOString(),
    );
  });

  it('counts distinct profiles across the members of a segment', async () => {
    const builders = [builder('a', hoursAgo(2)), builder('b', hoursAgo(3))];
    const { service, profilesFor } = setup({
      builders,
      profiles: new Map([
        ['a', ['p1', 'p2']],
        ['b', ['p2', 'p3']],
      ]),
    });
    const view = await service.view(NOW);
    expect(profilesFor).toHaveBeenCalledWith(['a', 'b']);
    expect(view.searches).toEqual([
      {
        key: 'linkedin_posts|en|backend|remote',
        hash: planSegments(builders).segments[0]!.hash,
        profiles: 3,
        oldestCoveredUntil: hoursAgo(3).toISOString(),
        overDay: false,
      },
    ]);
  });

  it('is over a day only past 24 hours, and never for a null cursor', async () => {
    const { service } = setup({
      builders: [
        builder('fresh', hoursAgo(24), { position: 'frontend' }),
        builder('stale', hoursAgo(25), { position: 'backend' }),
        builder('never', null, { position: 'mobile' }),
      ],
    });
    const view = await service.view(NOW);
    expect(
      view.searches.map(({ key, oldestCoveredUntil, overDay }) => ({
        key,
        oldestCoveredUntil,
        overDay,
      })),
    ).toEqual([
      {
        key: 'linkedin_posts|en|mobile|remote',
        oldestCoveredUntil: null,
        overDay: false,
      },
      {
        key: 'linkedin_posts|en|backend|remote',
        oldestCoveredUntil: hoursAgo(25).toISOString(),
        overDay: true,
      },
      {
        key: 'linkedin_posts|en|frontend|remote',
        oldestCoveredUntil: hoursAgo(24).toISOString(),
        overDay: false,
      },
    ]);
  });

  it('tells apart the segments one group splits into by their hash', async () => {
    // Spellings too long to merge into one search cut the group into parts.
    const builders = Array.from({ length: 4 }, (_, i) =>
      builder(`m${i}`, hoursAgo(i + 1), {
        params: {
          language: 'en',
          position: 'backend',
          remote: true,
          spellings: [`${i}${'x'.repeat(150)}`],
        },
      }),
    );
    const { service } = setup({ builders });
    const view = await service.view(NOW);
    expect(view.searches).toHaveLength(2);
    expect(new Set(view.searches.map((s) => s.key)).size).toBe(1);
    expect(view.searches.map((s) => s.hash).sort()).toEqual(
      planSegments(builders)
        .segments.map((s) => s.hash)
        .sort(),
    );
    expect(view.searches[0]!.hash).not.toBe(view.searches[1]!.hash);
  });

  it('orders the searches as longestWaitingFirst does', async () => {
    const builders = [
      builder('a', hoursAgo(1), { position: 'a' }),
      builder('b', hoursAgo(5), { position: 'b' }),
      builder('c', null, { position: 'c' }),
      builder('d', hoursAgo(3), { position: 'd' }),
    ];
    const { service } = setup({ builders });
    const view = await service.view(NOW);
    const expected = longestWaitingFirst(planSegments(builders).segments).map(
      (s) => s.key,
    );
    expect(view.searches.map((s) => s.key)).toEqual(expected);
    expect(expected[0]).toBe('linkedin_posts|en|c|remote');
  });

  it('lists every active builder when the paused set cannot be read', async () => {
    const warn = quiet();
    const { service } = setup({
      builders: [builder('a', hoursAgo(2)), builder('b', hoursAgo(3))],
      paused: new Error('db down'),
    });
    const view = await service.view(NOW);
    expect(view.pausedBuilders).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(view.searches).toHaveLength(1);
    expect(view.searches[0]!.oldestCoveredUntil).toBe(
      hoursAgo(3).toISOString(),
    );
  });

  it('still leaves out builders already paused when the paused set cannot be read, as the tick does', async () => {
    quiet();
    const { service } = setup({
      builders: [
        builder('a', hoursAgo(2)),
        builder('b', hoursAgo(3), { pausedAt: hoursAgo(10) }),
      ],
      paused: new Error('db down'),
    });
    const view = await service.view(NOW);
    expect(view.pausedBuilders).toBe(1);
    expect(view.searches[0]!.oldestCoveredUntil).toBe(
      hoursAgo(2).toISOString(),
    );
  });
});

describe('PostsBudgetReportService full runs', () => {
  it('groups the last 7 days of full runs per key, with counts and the last time', async () => {
    const latest = run(hoursAgo(5), 0.1, { segmentKey: 'k1', full: true });
    const { service } = setup({
      runs: [
        run(hoursAgo(8 * 24), 0.1, { segmentKey: 'k1', full: true }),
        run(hoursAgo(48), 0.1, { segmentKey: 'k1', full: true }),
        run(hoursAgo(30), 0.1, { segmentKey: 'k2', full: true }),
        latest,
        run(hoursAgo(4), 0.1, { segmentKey: 'k2', full: false }),
      ],
    });
    const view = await service.view(NOW);
    expect(view.fullRuns).toEqual([
      { key: 'k1', runs: 2, lastAt: latest.startedAt.toISOString() },
      { key: 'k2', runs: 1, lastAt: hoursAgo(30).toISOString() },
    ]);
  });
});
