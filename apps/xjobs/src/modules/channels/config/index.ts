import { Channel } from 'src/common/enums';

export interface ChannelConfig {
  enabled: boolean;
  schedule: { pattern: string; timezone: string };
  initialLookbackHours: number;
  overlapMinutes: number;
  maximumWindowHours: number;
  recoveryDays: number;
  maximumSearchesPerOperation: number;
  monthlyBudgetMicroUsd: number;
  maximumOperationBudgetMicroUsd: number;
  actor: string;
  discovery: Record<string, unknown>;
}

const hourly = {
  schedule: { pattern: '0 * * * *', timezone: 'UTC' },
  initialLookbackHours: 24,
  overlapMinutes: 15,
  maximumWindowHours: 24,
  recoveryDays: 7,
  maximumSearchesPerOperation: 10,
} as const;

export const channelConfig = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    ...hourly,
    enabled: true,
    actor: 'bebity/linkedin-jobs-scraper',
    discovery: {
      keywords: ['fullstack node', 'typescript', 'next js', 'react js'],
      locations: [
        'Worldwide',
        'EMEA',
        'European Union',
        'Morocco',
        'United Kingdom',
        'Germany',
      ],
      maxRowsPerUrl: 100,
      titleExcludes: [
        'sales',
        'account executive',
        'customer engineer',
        'servicenow',
        'salesforce',
        'sap',
        'outsystems',
        'mendix',
      ],
    },
    monthlyBudgetMicroUsd: 60_000_000,
    maximumOperationBudgetMicroUsd: 1_000_000,
  },
  [Channel.LINKEDIN_POSTS]: {
    ...hourly,
    enabled: true,
    actor: 'harvestapi/linkedin-post-search',
    discovery: {
      queries: [
        'hiring fullstack remote',
        'hiring typescript remote',
        'hiring react node remote',
        'hiring next js remote',
      ],
      maxPostsPerQuery: 100,
      linkTimeoutMs: 10_000,
      linkDelayMs: 1_000,
      linkMaxAttempts: 3,
    },
    monthlyBudgetMicroUsd: 30_000_000,
    maximumOperationBudgetMicroUsd: 750_000,
  },
  [Channel.GREEN_HOUSE]: {
    ...hourly,
    enabled: true,
    actor: 'apify/google-search-scraper',
    discovery: {
      site: 'greenhouse.io',
      terms: ['full stack', 'typescript', 'next.js', 'react', 'node'],
      suffix: 'remote',
      maxPagesPerQuery: 3,
      fetch: {
        timeoutMs: 10_000,
        concurrency: 4,
        maxAttempts: 3,
        maxBodyBytes: 2_000_000,
        delayMs: 100,
        retryWaitsMs: [2_000, 4_000, 8_000],
        maxRetryAfterMs: 30_000,
        retryBudgetMs: 120_000,
      },
    },
    monthlyBudgetMicroUsd: 5_000_000,
    maximumOperationBudgetMicroUsd: 500_000,
  },
  [Channel.ASHBY]: {
    ...hourly,
    enabled: true,
    actor: 'apify/google-search-scraper',
    discovery: {
      site: 'jobs.ashbyhq.com',
      terms: ['full stack', 'typescript', 'next.js', 'react', 'node'],
      suffix:
        '(intitle:engineer OR intitle:developer) -intitle:manager -intitle:director -intitle:intern "remote"',
      maxPagesPerQuery: 3,
      fetch: {
        timeoutMs: 10_000,
        concurrency: 4,
        maxAttempts: 3,
        maxBodyBytes: 2_000_000,
        delayMs: 250,
        retryWaitsMs: [2_000, 4_000, 8_000],
        maxRetryAfterMs: 30_000,
        retryBudgetMs: 120_000,
      },
    },
    monthlyBudgetMicroUsd: 5_000_000,
    maximumOperationBudgetMicroUsd: 500_000,
  },
} satisfies Record<Channel, ChannelConfig>;

export const globalApifyMonthlyBudgetMicroUsd = 80_000_000;
