/** How the processor sweeper runs. */
export const processSweepConfig = {
  /** Interval between sweeps. */
  everyMs: 60_000,
  /** Pending jobs re-enqueued per sweep. */
  limit: 200,
} as const;

/** The daily automatic silencing run (dry run while POST_AUTO_SILENCE is off). */
export const autoSilenceConfig = {
  pattern: '0 4 * * *',
  timezone: 'UTC',
} as const;
