/** Where a query search runs: one job source per value. Mirrors the `Channel` enum in the data contract. */
export enum Channel {
  LINKEDIN_JOB_BOARD = 'LINKEDIN_JOB_BOARD',
  LINKEDIN_JOB_BOARD_CHEAP = 'LINKEDIN_JOB_BOARD_CHEAP',
  LINKEDIN_JOB_BOARD_BEBITY = 'LINKEDIN_JOB_BOARD_BEBITY',
  LINKEDIN_POSTS = 'LINKEDIN_POSTS',
  GREEN_HOUSE = 'GREEN_HOUSE',
  ASHBY = 'ASHBY',
}

/**
 * The channels searches are built for. The others keep their builders and
 * collectors but get no searches. Whether a channel collects is `collectsNow`.
 */
export const ACTIVE_CHANNELS: readonly Channel[] = [
  Channel.LINKEDIN_JOB_BOARD,
  Channel.LINKEDIN_JOB_BOARD_CHEAP,
  Channel.LINKEDIN_JOB_BOARD_BEBITY,
];

/** Trial channels: LinkedIn job-board actors run beside the main one to compare them. */
export const TRIAL_CHANNELS: readonly Channel[] = [
  Channel.LINKEDIN_JOB_BOARD_CHEAP,
  Channel.LINKEDIN_JOB_BOARD_BEBITY,
];

/** True for the LinkedIn job board and every trial actor channel. */
export function isLinkedinJobBoard(channel: Channel | string): boolean {
  return (
    channel === Channel.LINKEDIN_JOB_BOARD ||
    TRIAL_CHANNELS.includes(channel as Channel)
  );
}

export function isTrialChannel(channel: Channel | string): boolean {
  return TRIAL_CHANNELS.includes(channel as Channel);
}
