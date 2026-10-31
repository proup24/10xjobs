export const JOB_CONFIG = {
  schedule: { pattern: '0 * * * *', timezone: 'UTC' },
  initialLookbackHours: 24,
  overlapMinutes: 15,
  maximumWindowHours: 24,
  recoveryDays: 7,
  maximumSearchesPerOperation: 10,
} as const;
