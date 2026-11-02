import { ACTIVE_CHANNELS, Channel } from 'src/common/enums';
import type {
  ActorRunConfig,
  BoardSearchRunConfig,
  LinkedinJobBoardRunConfig,
  LinkedinPostsRunConfig,
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
  /** The channel's actor and its limits. */
  run: R;
}

const hourly = {
  enabled: true,
  schedule: { pattern: '0 * * * *', timezone: 'UTC' },
  concurrency: 1,
  attempts: 1,
  segmentSize: 10,
  window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 },
} as const;


const tenMinutes = {
  enabled: true,
  schedule: { pattern: '*/10 * * * *', timezone: 'UTC' },
  concurrency: 1,
  attempts: 1,
  segmentSize: 10,
  window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 },
} as const;


const twoMinutes = {
  enabled: true,
  schedule: { pattern: '*/2 * * * *', timezone: 'UTC' },
  concurrency: 1,
  attempts: 1,
  segmentSize: 10,
  window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 },
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
} as const;

/** One dedicated config per channel job; actors and caps carried over from career-hub. */
export const channelJobsConfig = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    queueName: 'collect-linkedin-job-board',
    ...twoMinutes,
    enabled: ACTIVE_CHANNELS.includes(Channel.LINKEDIN_JOB_BOARD),
    run: {
      actor: 'bebity/linkedin-jobs-scraper',
      maxRunChargeUsd: 1,
      maxRowsPerUrl: 100,
    },
  },
  [Channel.LINKEDIN_POSTS]: {
    queueName: 'collect-linkedin-posts',
    ...hourly,
    enabled: ACTIVE_CHANNELS.includes(Channel.LINKEDIN_POSTS),
    run: {
      actor: 'harvestapi/linkedin-post-search',
      maxRunChargeUsd: 0.75,
      maxPostsPerQuery: 100,
    },
  },
  [Channel.GREEN_HOUSE]: {
    queueName: 'collect-greenhouse',
    ...daily,
    enabled: ACTIVE_CHANNELS.includes(Channel.GREEN_HOUSE),
    run: {
      actor: 'apify/google-search-scraper',
      maxRunChargeUsd: 0.5,
      site: 'job-boards.greenhouse.io',
      suffix: '',
      // Google serves 10 results per page (no `num=100` since Sept 2025);
      // at 3 pages every query was truncated.
      maxPagesPerQuery: 10,
    },
  },
  [Channel.ASHBY]: {
    queueName: 'collect-ashby',
    ...daily,
    enabled: ACTIVE_CHANNELS.includes(Channel.ASHBY),
    run: {
      actor: 'apify/google-search-scraper',
      maxRunChargeUsd: 0.5,
      site: 'jobs.ashbyhq.com',
      suffix:
        '(intitle:engineer OR intitle:developer OR intitle:lead) -intitle:manager -intitle:director -intitle:intern -intitle:recruiter',
      // Google serves 10 results per page (no `num=100` since Sept 2025);
      // at 3 pages every query was truncated.
      maxPagesPerQuery: 10,
    },
  },
} satisfies {
  [Channel.LINKEDIN_JOB_BOARD]: ChannelJobConfig<LinkedinJobBoardRunConfig>;
  [Channel.LINKEDIN_POSTS]: ChannelJobConfig<LinkedinPostsRunConfig>;
  [Channel.GREEN_HOUSE]: ChannelJobConfig<BoardSearchRunConfig>;
  [Channel.ASHBY]: ChannelJobConfig<BoardSearchRunConfig>;
};
