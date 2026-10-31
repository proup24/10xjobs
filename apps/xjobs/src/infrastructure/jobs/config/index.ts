import { Channel } from 'src/common/enums';

/** How one channel's collection worker runs. */
export interface ChannelJobConfig {
  /** A disabled channel's worker removes its schedule and exits. */
  enabled: boolean;
  /** Cron pattern for the recurring collect job. */
  schedule: { pattern: string; timezone: string };
  /** Collect jobs run at once in the channel's worker; 1 avoids overlapping paid runs. */
  concurrency: number;
  /** BullMQ attempts per collect job; 1 means a failed paid run waits for the next tick. */
  attempts: number;
}

const hourly: ChannelJobConfig = {
  enabled: true,
  schedule: { pattern: '0 * * * *', timezone: 'UTC' },
  concurrency: 1,
  attempts: 1,
};

/** One dedicated config per channel worker. */
export const channelJobsConfig: Record<Channel, ChannelJobConfig> = {
  [Channel.LINKEDIN_JOB_BOARD]: { ...hourly },
  [Channel.LINKEDIN_POSTS]: { ...hourly },
  [Channel.GREEN_HOUSE]: { ...hourly },
  [Channel.ASHBY]: { ...hourly },
};
