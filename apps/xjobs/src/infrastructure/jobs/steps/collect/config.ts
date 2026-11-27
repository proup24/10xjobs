import { ACTIVE_CHANNELS, Channel, isTrialChannel } from 'src/common/enums';
import {
  type ActorRunConfig,
  type BoardSearchRunConfig,
  type LinkedinJobBoardRunConfig,
  AshbyCollector,
  GreenhouseCollector,
  LinkedinJobBoardBebityCollector,
  LinkedinJobBoardCheapCollector,
  LinkedinJobBoardCollector,
  type LinkedinPostsRunConfig,
  LinkedinPostsCollector,
  IndeedCollector,
} from 'src/modules/collectors';
import type { WindowConfig } from 'src/modules/segments';

/** How one channel's collection job runs. */
export interface ChannelJobConfig<R extends ActorRunConfig = ActorRunConfig> {
  queueName: string;
  /** A disabled channel's worker removes its schedule and exits. */
  enabled: boolean;
  /** Cron pattern for the recurring collect job. */
  schedule: { pattern: string; timezone: string };
  /** Collect jobs run at once in the channel's worker; 1 avoids overlapping paid runs. */
  concurrency: number;
  /** BullMQ attempts per collect job; 1 means a failed paid run waits for the next tick. */
  attempts: number;
  /** Builders searched together in one Apify run. */
  segmentSize: number;
  /** The span each segment run searches. */
  window: WindowConfig;
  /** A woken builder's cursor goes back to this many hours before the tick. */
  resumeHours: number;
  /** How long a run holds its claim on a query; longer than the slowest segment run. */
  claimLeaseMinutes: number;
  /** The channel's actor and its limits. */
  run: R;
}

const hourly = {
  enabled: true,
  schedule: { pattern: '0 8-22 * * 1-5', timezone: 'UTC' },
  concurrency: 1,
  attempts: 1,
  segmentSize: 10,
  window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 },
  resumeHours: 1,
  claimLeaseMinutes: 30,
} as const;

/** Hourly 09-21 Morocco time, one hour back: harvestapi's `postedLimit` is `1h`. */
const linkedinJobBoard = {
  ...hourly,
  schedule: { pattern: '0 9-21 * * 1-5', timezone: 'Africa/Casablanca' },
  window: { initialHours: 1, overlapMinutes: 0, maximumHours: 1 },
} as const;

/**
 * Posts hourly every day over the day just gone, five minutes of overlap;
 * each run's charge limit is what is left of the day's posts budget.
 */
const linkedinPosts = {
  ...hourly,
  schedule: { pattern: '0 * * * *', timezone: 'Africa/Casablanca' },
  window: { initialHours: 24, overlapMinutes: 5, maximumHours: 24 },
} as const;

/**
 * Indeed every 3 hours, 09:00 to 21:00 Morocco time on weekdays (09, 12, 15,
 * 18, 21). Each run asks for the last 24 hours (Indeed's smallest filter), so
 * hourly ticks paid mostly for repeat rows. A gap widens the window up to 72
 * hours (Indeed's 3-day filter), no further. Each run's charge limit is what is
 * left of the day's Indeed budget.
 */
const indeed = {
  ...hourly,
  schedule: { pattern: '0 9-21/3 * * 1-5', timezone: 'Africa/Casablanca' },
  window: { initialHours: 24, overlapMinutes: 0, maximumHours: 72 },
  resumeHours: 24,
} as const;

/**
 * Google indexes ATS pages hours to days after they are posted, so board
 * discovery runs daily over at least three days; ingest drops the overlap.
 */
const daily = {
  ...hourly,
  schedule: { pattern: '0 6 * * *', timezone: 'UTC' },
  window: {
    initialHours: 72,
    overlapMinutes: 0,
    maximumHours: 168,
    minimumHours: 72,
  },
  resumeHours: 24,
} as const;

/** One dedicated config per channel job; each `run` is its collector's static actor config. */
export const channelJobsConfig = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    queueName: 'collect-linkedin-job-board',
    ...linkedinJobBoard,
    enabled: ACTIVE_CHANNELS.includes(Channel.LINKEDIN_JOB_BOARD),
    run: LinkedinJobBoardCollector.config,
  },
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: {
    queueName: 'collect-linkedin-job-board-cheap',
    ...linkedinJobBoard,
    enabled: ACTIVE_CHANNELS.includes(Channel.LINKEDIN_JOB_BOARD_CHEAP),
    run: LinkedinJobBoardCheapCollector.config,
  },
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: {
    queueName: 'collect-linkedin-job-board-bebity',
    ...linkedinJobBoard,
    enabled: ACTIVE_CHANNELS.includes(Channel.LINKEDIN_JOB_BOARD_BEBITY),
    run: LinkedinJobBoardBebityCollector.config,
  },
  [Channel.LINKEDIN_POSTS]: {
    queueName: 'collect-linkedin-posts',
    ...linkedinPosts,
    // On by itself, under COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS, not through ACTIVE_CHANNELS.
    enabled: true,
    run: LinkedinPostsCollector.config,
  },
  [Channel.GREEN_HOUSE]: {
    queueName: 'collect-greenhouse',
    ...daily,
    enabled: ACTIVE_CHANNELS.includes(Channel.GREEN_HOUSE),
    run: GreenhouseCollector.config,
  },
  [Channel.ASHBY]: {
    queueName: 'collect-ashby',
    ...daily,
    enabled: ACTIVE_CHANNELS.includes(Channel.ASHBY),
    run: AshbyCollector.config,
  },
  [Channel.INDEED]: {
    queueName: 'collect-indeed',
    ...indeed,
    // Switch-only, like posts: on by itself, under COLLECTION_DAILY_BUDGET_USD_INDEED.
    enabled: true,
    run: IndeedCollector.config,
  },
} satisfies {
  [Channel.LINKEDIN_JOB_BOARD]: ChannelJobConfig<LinkedinJobBoardRunConfig>;
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: ChannelJobConfig<LinkedinJobBoardRunConfig>;
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: ChannelJobConfig<LinkedinJobBoardRunConfig>;
  [Channel.LINKEDIN_POSTS]: ChannelJobConfig<LinkedinPostsRunConfig>;
  [Channel.GREEN_HOUSE]: ChannelJobConfig<BoardSearchRunConfig>;
  [Channel.ASHBY]: ChannelJobConfig<BoardSearchRunConfig>;
  [Channel.INDEED]: ChannelJobConfig;
};

/**
 * Whether a channel's worker collects now: it is enabled and, when it is a
 * trial channel, listed in `COLLECTION_TRIAL_CHANNELS`.
 */
export function collectsNow(
  channel: Channel,
  trialChannels: readonly Channel[],
): boolean {
  return (
    channelJobsConfig[channel].enabled &&
    (!isTrialChannel(channel) || trialChannels.includes(channel))
  );
}
