/** Where a query search runs: one job source per value. Mirrors the `Channel` enum in the data contract. */
export enum Channel {
  LINKEDIN_JOB_BOARD = 'LINKEDIN_JOB_BOARD',
  LINKEDIN_POSTS = 'LINKEDIN_POSTS',
  GREEN_HOUSE = 'GREEN_HOUSE',
  ASHBY = 'ASHBY',
}

/**
 * The channels queries are built for and collected from. The others keep
 * their builders and collectors but get no searches and no collect schedule.
 */
export const ACTIVE_CHANNELS: readonly Channel[] = [Channel.LINKEDIN_JOB_BOARD];
