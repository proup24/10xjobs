/** How the processor sweeper runs. */
export const processSweepConfig = {
  /** Interval between sweeps. */
  everyMs: 60_000,
  /** Pending jobs re-enqueued per sweep. */
  limit: 200,
} as const;
