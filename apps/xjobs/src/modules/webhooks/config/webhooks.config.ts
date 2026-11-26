export const WEBHOOK_CONFIG = {
  retryDelaysMs: [
    60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
  ],
  maxAttempts: 7,
  autoDisableAfter: 10,
  timeoutMs: 10_000,
  maxResponseBytes: 1024,
  maxErrorChars: 200,
  maxDescriptionChars: 20_000,
  sweep: { everyMs: 60_000, limit: 200 },
  stuckSendingMs: 300_000,
  retentionDays: 30,
  callbackToleranceSeconds: 300,
  callbackPerMinute: 60,
} as const;
