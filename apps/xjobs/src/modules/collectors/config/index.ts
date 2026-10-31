import { Channel } from 'src/common/enums';

/**
 * Operational settings per channel. What gets searched comes from the active
 * query search builders; when it runs comes from `infrastructure/jobs/config`.
 */
export interface LinkedinJobBoardDiscovery {
  maxRowsPerUrl: number;
  titleExcludes: string[];
}

export interface LinkedinPostsDiscovery {
  maxPostsPerQuery: number;
  linkTimeoutMs: number;
  linkDelayMs: number;
  linkMaxAttempts: number;
}

export interface JobBoardFetchConfig {
  timeoutMs: number;
  concurrency: number;
  maxAttempts: number;
  maxBodyBytes: number;
  delayMs: number;
  retryWaitsMs: number[];
  maxRetryAfterMs: number;
  retryBudgetMs: number;
}

export interface GreenhouseDiscovery {
  site: string;
  suffix: string;
  maxPagesPerQuery: number;
  fetch: JobBoardFetchConfig;
}

export interface AshbyDiscovery {
  site: string;
  suffix: string;
  maxPagesPerQuery: number;
  fetch: JobBoardFetchConfig;
}

interface ChannelConfigBase {
  monthlyBudgetMicroUsd: number;
  maximumOperationBudgetMicroUsd: number;
  actor: string;
}

export interface ChannelConfig extends ChannelConfigBase {
  discovery: Record<string, unknown>;
}

export interface LinkedinJobBoardConfig extends ChannelConfigBase {
  discovery: LinkedinJobBoardDiscovery;
}

export interface LinkedinPostsConfig extends ChannelConfigBase {
  discovery: LinkedinPostsDiscovery;
}

export interface GreenhouseConfig extends ChannelConfigBase {
  discovery: GreenhouseDiscovery;
}

export interface AshbyConfig extends ChannelConfigBase {
  discovery: AshbyDiscovery;
}

export type ChannelConfigMap = {
  [Channel.LINKEDIN_JOB_BOARD]: LinkedinJobBoardConfig;
  [Channel.LINKEDIN_POSTS]: LinkedinPostsConfig;
  [Channel.GREEN_HOUSE]: GreenhouseConfig;
  [Channel.ASHBY]: AshbyConfig;
};

export const channelConfig = {
  [Channel.LINKEDIN_JOB_BOARD]: {
    actor: 'bebity/linkedin-jobs-scraper',
    discovery: {
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
    actor: 'harvestapi/linkedin-post-search',
    discovery: {
      maxPostsPerQuery: 100,
      linkTimeoutMs: 10_000,
      linkDelayMs: 1_000,
      linkMaxAttempts: 3,
    },
    monthlyBudgetMicroUsd: 30_000_000,
    maximumOperationBudgetMicroUsd: 750_000,
  },
  [Channel.GREEN_HOUSE]: {
    actor: 'apify/google-search-scraper',
    discovery: {
      site: 'greenhouse.io',
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
    actor: 'apify/google-search-scraper',
    discovery: {
      site: 'jobs.ashbyhq.com',
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
} satisfies ChannelConfigMap;

export const globalApifyMonthlyBudgetMicroUsd = 80_000_000;
