import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from 'src/common/enums';
import type { EnvironmentVariables } from 'src/config';
import type { QuerySearchBuilderRow } from 'src/database';
import { ActivityRepository } from 'src/modules/activity';
import { QuerySearchService } from 'src/modules/queries';
import {
  DailyBudget,
  longestWaitingFirst,
  moroccoDayStart,
  planSegments,
  POSTS_NULL_COST_MICRO_USD,
  PostsBudgetService,
  postsBudgetReached,
  type SearchSegment,
} from 'src/modules/segments';
import {
  PostsBudgetRepository,
  type PostsBudgetRun,
} from './posts-budget.repository';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PAST_DAYS = 7;

export interface PostsBudgetDayView {
  dayStart: string;
  spentUsd: number;
  reachedAt: string | null;
}

export interface PostsBudgetSearchView {
  key: string;
  profiles: number;
  oldestCoveredUntil: string | null;
  overDay: boolean;
}

export interface PostsBudgetFullRunsView {
  key: string;
  runs: number;
  lastAt: string;
}

export interface PostsBudgetView {
  limitUsd: number;
  today: PostsBudgetDayView;
  /** The 7 Morocco days before today, newest first. */
  days: PostsBudgetDayView[];
  /** Current post searches of runnable builders, most behind first. */
  searches: PostsBudgetSearchView[];
  /** Active post builders left out because every owner is paused for inactivity. */
  pausedBuilders: number;
  /** Runs of the last 7 days whose result came back full, per segment key. */
  fullRuns: PostsBudgetFullRunsView[];
}

/** The owner's report on LinkedIn post search spend and how far behind the searches are. */
@Injectable()
export class PostsBudgetReportService {
  private readonly logger = new Logger(PostsBudgetReportService.name);

  constructor(
    private readonly repository: PostsBudgetRepository,
    private readonly budget: PostsBudgetService,
    private readonly queries: QuerySearchService,
    private readonly activity: ActivityRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async view(now: Date): Promise<PostsBudgetView> {
    const today = await this.budget.today(now);
    const starts = [today.dayStart];
    let earliest = today.dayStart;
    for (let i = 0; i < PAST_DAYS; i++) {
      earliest = moroccoDayStart(new Date(earliest.getTime() - 1));
      starts.push(earliest);
    }
    const runs = await this.repository.runsSince(earliest);

    const byDay = new Map<number, PostsBudgetRun[]>(
      starts.map((start) => [start.getTime(), []]),
    );
    for (const run of runs)
      byDay.get(moroccoDayStart(run.startedAt).getTime())?.push(run);
    // Past days are judged against today's limit: the limit each day had is not stored.
    const day = (start: Date): PostsBudgetDayView =>
      dayView(start, today.limitUsd, byDay.get(start.getTime()) ?? []);

    const { searches, pausedBuilders } = await this.searches(now);
    return {
      limitUsd: today.limitUsd,
      // Spend agrees with the tick's read; the walk finds when it was reached.
      today: {
        ...day(today.dayStart),
        spentUsd: new DailyBudget(
          today.limitUsd,
          today.spentMicroUsd,
          today.dayStart,
        ).spentUsd,
      },
      days: starts.slice(1).map(day),
      searches,
      pausedBuilders,
      fullRuns: fullRuns(
        runs.filter(
          (run) => run.startedAt.getTime() >= now.getTime() - 7 * DAY_MS,
        ),
      ),
    };
  }

  /**
   * The post segments the tick would plan now, in the order it runs them.
   * Mirrors `CollectionService.runnableBuilders` without its side effects (no
   * mark or wake): builders whose every owner is paused are left out, and when
   * the paused set can't be read it fails open the same way, leaving out only
   * builders already marked paused.
   */
  private async searches(
    now: Date,
  ): Promise<{ searches: PostsBudgetSearchView[]; pausedBuilders: number }> {
    const channel = Channel.LINKEDIN_POSTS;
    const hours = this.config.get('SEARCH_PAUSE_AFTER_HOURS', { infer: true });
    let paused: Set<string> | null;
    try {
      paused = await this.activity.pausedBuilderIds(channel, now, hours);
    } catch (error) {
      this.logger.warn(
        `Paused post builders could not be read (${error instanceof Error ? error.message : String(error)}); listing all but those already paused`,
      );
      paused = null;
    }
    const listed = await this.queries.listActive(channel);
    const builders = listed.filter((builder: QuerySearchBuilderRow) =>
      paused ? !paused.has(builder.id) : !builder.pausedAt,
    );
    const segments = longestWaitingFirst(planSegments(builders).segments);
    const profiles = await this.repository.profilesFor(
      builders.map((builder) => builder.id),
    );
    return {
      searches: segments.map((segment) => searchView(segment, profiles, now)),
      pausedBuilders: listed.length - builders.length,
    };
  }
}

/**
 * A day's spend, and when it was reached: walking its runs in start order,
 * the `finishedAt` of the first run after which no further run could start
 * (the limit spent or less than $0.01 left). A run with no cost counts $0.25.
 * Runs are recorded only once finished, so every run has a `finishedAt`.
 */
function dayView(
  dayStart: Date,
  limitUsd: number,
  runs: readonly PostsBudgetRun[],
): PostsBudgetDayView {
  const budget = new DailyBudget(limitUsd, 0, dayStart);
  let reachedAt: Date | null = null;
  for (const run of runs) {
    budget.add(run.costMicroUsd ?? POSTS_NULL_COST_MICRO_USD);
    if (!reachedAt && postsBudgetReached(budget)) reachedAt = run.finishedAt;
  }
  return {
    dayStart: dayStart.toISOString(),
    spentUsd: budget.spentUsd,
    reachedAt: reachedAt?.toISOString() ?? null,
  };
}

function searchView(
  segment: SearchSegment,
  profiles: ReadonlyMap<string, string[]>,
  now: Date,
): PostsBudgetSearchView {
  const cursors = segment.members.map((member) => member.coveredUntil);
  const times = cursors.flatMap((cursor) => (cursor ? [cursor.getTime()] : []));
  // A member never searched makes the segment's oldest cursor unknown.
  const oldest =
    times.length < cursors.length ? null : new Date(Math.min(...times));
  const ids = new Set(
    segment.members.flatMap((member) => profiles.get(member.id) ?? []),
  );
  return {
    key: segment.key,
    profiles: ids.size,
    oldestCoveredUntil: oldest?.toISOString() ?? null,
    overDay: oldest !== null && now.getTime() - oldest.getTime() > DAY_MS,
  };
}

/** Full runs per segment key, most runs first, then the latest first. */
function fullRuns(runs: readonly PostsBudgetRun[]): PostsBudgetFullRunsView[] {
  const groups = new Map<string, { runs: number; lastAt: Date }>();
  for (const run of runs) {
    if (!run.full) continue;
    const group = groups.get(run.segmentKey);
    if (!group) groups.set(run.segmentKey, { runs: 1, lastAt: run.startedAt });
    else {
      group.runs += 1;
      if (run.startedAt > group.lastAt) group.lastAt = run.startedAt;
    }
  }
  return [...groups]
    .sort(
      ([, a], [, b]) =>
        b.runs - a.runs || b.lastAt.getTime() - a.lastAt.getTime(),
    )
    .map(([key, group]) => ({
      key,
      runs: group.runs,
      lastAt: group.lastAt.toISOString(),
    }));
}
