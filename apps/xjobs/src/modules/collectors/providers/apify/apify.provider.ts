import { Injectable, Logger, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApifyApiError,
  ApifyClient,
  type Actor,
  type ActorRun,
  type ActorRunListItem,
  type PaginatedList,
} from 'apify-client';
import { getApifyToken, type EnvironmentVariables } from 'src/config';
import { SearchNotStartedError } from '../../utils/search-not-started';

export type ApifyRunStatus = ActorRun['status'];

export interface ApifyStartOptions {
  /** Spend cap for the run, in USD. */
  maxChargeUsd: number;
  /** Platform-side run timeout, in seconds. */
  timeoutSecs?: number;
  memoryMbytes?: number;
}

export interface ApifyRunOptions extends ApifyStartOptions {
  /** How long to wait for the run before aborting it, in seconds. */
  waitSecs?: number;
}

/** A finished run's dataset and what Apify charged for it. */
export interface ApifyRunResult {
  items: unknown[];
  /** `usageTotalUsd`, or null when Apify did not report it. */
  costUsd: number | null;
  /** The Apify run id. */
  runId: string;
  /** The run's default key-value store, where actors put side records. */
  keyValueStoreId: string | null;
}

export interface ApifyListRunsOptions {
  status?: ApifyRunStatus | ApifyRunStatus[];
  startedAfter?: Date;
  startedBefore?: Date;
  offset?: number;
  limit?: number;
  /** Newest first. Defaults to true. */
  desc?: boolean;
}

export interface ApifyListItemsOptions {
  offset?: number;
  limit?: number;
}

const DEFAULT_WAIT_SECS = 300;
const UNFINISHED: readonly ApifyRunStatus[] = ['READY', 'RUNNING'];

/** A started Apify run that did not finish in time or ended other than SUCCEEDED. */
export class ApifyRunError extends Error {
  constructor(
    message: string,
    readonly runId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApifyRunError';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApifyApiError && error.statusCode === 404;
}

/**
 * Apify refused the start request itself (a 4xx, such as actor permissions not
 * approved or no credit), so no run exists. The start is the only POST `call`
 * makes; a 5xx may still have created the run, so it does not count.
 */
function isRefusedStart(error: unknown): boolean {
  return (
    error instanceof ApifyApiError &&
    error.httpMethod?.toLowerCase() === 'post' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}

/**
 * Thin wrapper over the official Apify client. The token comes from the config
 * service and the client is built on first use, so the API boots without one.
 * Transient: every Apify trigger that injects it gets its own client.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class ApifyActorProvider {
  private readonly logger = new Logger(ApifyActorProvider.name);
  private apify?: ApifyClient;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private get client(): ApifyClient {
    this.apify ??= new ApifyClient({ token: getApifyToken(this.config) });
    return this.apify;
  }

  /**
   * Runs an actor to completion and returns every item of its default dataset
   * with the run's cost. A run still going after `waitSecs` is aborted so it
   * stops spending. A start Apify refused throws a {@link SearchNotStartedError}.
   */
  async run(
    actor: string,
    input: Record<string, unknown>,
    options: ApifyRunOptions,
  ): Promise<ApifyRunResult> {
    let run: ActorRun;
    try {
      run = await this.client.actor(actor).call(input, {
        ...this.startOptions(options),
        waitSecs: options.waitSecs ?? DEFAULT_WAIT_SECS,
      });
    } catch (error) {
      if (isRefusedStart(error))
        throw new SearchNotStartedError(
          `Apify refused to start ${actor}: ${errorText(error)}`,
          { cause: error },
        );
      throw error;
    }
    if (UNFINISHED.includes(run.status)) {
      try {
        await this.abortRun(run.id);
      } catch (error) {
        // The run exists either way: keep its id so its cost can be read again.
        throw new ApifyRunError(
          `Apify actor ${actor} run ${run.id} did not finish in time and could not be aborted: ${errorText(error)}`,
          run.id,
          { cause: error },
        );
      }
      throw new ApifyRunError(
        `Apify actor ${actor} run ${run.id} did not finish in time and was aborted`,
        run.id,
      );
    }
    if (run.status !== 'SUCCEEDED') {
      throw new ApifyRunError(
        `Apify actor ${actor} run ${run.id} ended ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''}`,
        run.id,
      );
    }
    let items: unknown[];
    try {
      items = await this.items(run.defaultDatasetId);
    } catch (error) {
      throw new ApifyRunError(
        `Apify actor ${actor} run ${run.id} succeeded but its dataset could not be read: ${errorText(error)}`,
        run.id,
        { cause: error },
      );
    }
    return {
      items,
      costUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null,
      runId: run.id,
      keyValueStoreId: run.defaultKeyValueStoreId ?? null,
    };
  }

  /** Starts an actor run without waiting for it. */
  start(
    actor: string,
    input: Record<string, unknown>,
    options: ApifyStartOptions,
  ): Promise<ActorRun> {
    return this.client.actor(actor).start(input, this.startOptions(options));
  }

  /** Waits for a run to finish, or for `waitSecs`, and returns its latest state. */
  waitForRun(runId: string, waitSecs = DEFAULT_WAIT_SECS): Promise<ActorRun> {
    return this.client.run(runId).waitForFinish({ waitSecs });
  }

  async findRun(runId: string): Promise<ActorRun | null> {
    return (await this.client.run(runId).get()) ?? null;
  }

  async findActor(actor: string): Promise<Actor | null> {
    return (await this.client.actor(actor).get()) ?? null;
  }

  /** One page of an actor's runs, newest first unless `desc` is false. */
  listRuns(
    actor: string,
    options: ApifyListRunsOptions = {},
  ): Promise<PaginatedList<ActorRunListItem>> {
    return this.client
      .actor(actor)
      .runs()
      .list({ desc: true, ...options });
  }

  /** A run's log text, or null when it can't be read. */
  async runLog(runId: string): Promise<string | null> {
    try {
      return (await this.client.log(runId).get()) ?? null;
    } catch {
      this.logger.warn(`Could not read the log of Apify run ${runId}`);
      return null;
    }
  }

  /** Aborts a run; a run that is already gone is not an error. */
  async abortRun(runId: string): Promise<ActorRun | null> {
    try {
      return await this.client.run(runId).abort();
    } catch (error) {
      if (isNotFound(error)) return null;
      this.logger.warn(`Could not abort Apify run ${runId}`);
      throw error;
    }
  }

  /** One page of a dataset's items. */
  listItems(
    datasetId: string,
    options: ApifyListItemsOptions = {},
  ): Promise<PaginatedList<Record<string | number, unknown>>> {
    return this.client.dataset(datasetId).listItems(options);
  }

  /** Every item of a dataset, fetched page by page. */
  async items(datasetId: string): Promise<unknown[]> {
    const items: unknown[] = [];
    for await (const item of this.client.dataset(datasetId).listItems()) {
      items.push(item);
    }
    return items;
  }

  private startOptions(options: ApifyStartOptions) {
    return {
      maxTotalChargeUsd: options.maxChargeUsd,
      timeout: options.timeoutSecs,
      memory: options.memoryMbytes,
    };
  }
}
