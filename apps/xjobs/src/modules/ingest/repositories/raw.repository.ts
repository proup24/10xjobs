import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type CollectionBatchRow,
  DatabaseService,
  isRetryableTransactionError,
  type RawItemVersionRow,
} from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import { INGEST_WAITING_CHANNELS } from '../config';
import type { BatchReport, BatchStatus } from '../types';
import { type LinkJobInput, type LinkOutcome, linkJob } from './jobs.writer';

export type { LinkOutcome };

/** The part of a batch row ingest needs. */
export interface BatchRecord {
  id: string;
  channel: Channel;
  storageKey: string;
  status: BatchStatus;
  attempts: number;
}

/** One validated item of a batch, ready to store. */
export interface SaveItemInput {
  batchId: string;
  channel: Channel;
  kind: 'job' | 'post';
  sourceKey: string;
  contentHash: string;
  payload: unknown;
  /** Null for an item no member query claimed. */
  queryId: string | null;
  rank: number | null;
  observedAt: Date;
}

/** What saving one item did, raw and normalized. */
export interface SaveItemResult {
  newItem: boolean;
  newVersion: boolean;
  job: LinkOutcome;
}

/** Stores raw items and moves collection batches through their statuses. */
export abstract class RawStorageRepository {
  abstract findBatch(id: string): Promise<BatchRecord | null>;
  /**
   * One transaction per item: raw rows, then its normalized job. Saving the
   * same item again writes nothing new.
   */
  abstract saveItem(input: SaveItemInput): Promise<SaveItemResult>;
  /** Only from `pending`. */
  abstract markIngested(id: string, report: BatchReport): Promise<void>;
  /** Counts a failed attempt; the final one marks the batch `failed`. */
  abstract recordAttemptFailure(
    id: string,
    error: string,
    final: boolean,
  ): Promise<void>;
  /** A batch whose file cannot be read: `failed` at once. */
  abstract markFailed(id: string, reason: string): Promise<void>;
  /** Only from `failed`; resets attempts. False when the batch was not failed. */
  abstract resetToPending(id: string): Promise<boolean>;
  /** Pending batches created before `olderThan`, oldest first. */
  abstract listStalePending(olderThan: Date, limit: number): Promise<string[]>;
}

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 10;
const NO_QUERY = 'none';

const min = (a: Date, b: Date) => (a < b ? a : b);
const max = (a: Date, b: Date) => (a > b ? a : b);

type Json = RawItemVersionRow['payload'];

/**
 * Runs `fn` in a transaction, re-running it from the start when it loses a
 * uniqueness race, serialization failure or deadlock.
 */
export async function inRetriedTransaction<T>(
  database: Pick<DatabaseService, 'db'>,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await database.db.transaction(fn);
    } catch (error) {
      if (
        attempt >= MAX_TRANSACTION_RETRIES ||
        !isRetryableTransactionError(error)
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt),
      );
    }
  }
}

/** Connection-level failures: the database is unreachable, not the data wrong. */
function isInfrastructureError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth++) {
    if (typeof current !== 'object') return false;
    const { sqlState, code } = current as {
      sqlState?: unknown;
      code?: unknown;
    };
    if (typeof sqlState === 'string' && /^(08|53|57|58|XX)/.test(sqlState))
      return true;
    if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return isRetryableTransactionError(error);
}

/**
 * Links a raw item to its normalized job in its own transaction, after the
 * raw rows committed: raw storage never depends on normalization. A data
 * error while linking makes the item `invalid` for normalization instead of
 * failing the batch; an unreachable database still fails it, so it retries.
 */
export async function linkJobSafely(
  database: Pick<DatabaseService, 'db'>,
  input: LinkJobInput,
): Promise<LinkOutcome> {
  try {
    return await inRetriedTransaction(database, (tx) => linkJob(tx, input));
  } catch (error) {
    if (isInfrastructureError(error)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return { invalid: `normalize: ${reason}` };
  }
}

@Injectable()
export class PrismaRawStorageRepository extends RawStorageRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get batches() {
    return this.database.db.orm.public.CollectionBatch;
  }

  async findBatch(id: string): Promise<BatchRecord | null> {
    const row = await this.batches.where({ id }).first();
    return row ? record(row) : null;
  }

  async saveItem(input: SaveItemInput): Promise<SaveItemResult> {
    const { rawItemId, newItem, newVersion } = await inRetriedTransaction(
      this.database,
      (tx) => save(tx, input),
    );
    const job = await linkJobSafely(this.database, {
      rawItemId,
      observedAt: input.observedAt,
      rebuild: false,
    });
    return { newItem, newVersion, job };
  }

  async markIngested(id: string, report: BatchReport): Promise<void> {
    await this.batches.where({ id, status: 'pending' }).updateAll({
      status: 'ingested',
      ingestedAt: new Date(),
      report: report as unknown as CollectionBatchRow['report'],
      lastError: null,
    });
  }

  async recordAttemptFailure(
    id: string,
    error: string,
    final: boolean,
  ): Promise<void> {
    const row = await this.batches.where({ id, status: 'pending' }).first();
    if (!row) return;
    await this.batches.where({ id, status: 'pending' }).updateAll({
      attempts: row.attempts + 1,
      lastError: error,
      ...(final ? { status: 'failed' } : {}),
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.batches
      .where({ id, status: 'pending' })
      .updateAll({ status: 'failed', lastError: reason });
  }

  async resetToPending(id: string): Promise<boolean> {
    const updated = await this.batches
      .where({ id, status: 'failed' })
      .updateAll({ status: 'pending', attempts: 0 });
    return updated.length > 0;
  }

  async listStalePending(olderThan: Date, limit: number): Promise<string[]> {
    const rows = await this.batches
      .where({ status: 'pending' })
      .where((row) => row.channel.in(ingestibleChannels))
      .where((row) => row.createdAt.lt(olderThan))
      .orderBy((row) => row.createdAt.asc())
      .limit(limit)
      .all();
    return rows.map((row) => row.id);
  }
}

/** Channels whose batches the sweeper may re-enqueue. */
const ingestibleChannels: Channel[] = Object.values(Channel).filter(
  (channel) => !INGEST_WAITING_CHANNELS.includes(channel),
);

function record(row: CollectionBatchRow): BatchRecord {
  return {
    id: row.id,
    channel: row.channel as Channel,
    storageKey: row.storageKey,
    status: row.status as BatchStatus,
    attempts: row.attempts,
  };
}

/**
 * Item, version and sighting of one observation. The item row lock serializes
 * every save of the same item, so the existence checks below cannot race.
 */
async function save(
  tx: DatabaseTransaction,
  input: SaveItemInput,
): Promise<{ rawItemId: string; newItem: boolean; newVersion: boolean }> {
  const { orm } = tx;
  const at = input.observedAt;

  let item = await orm.public.RawItem.where({
    channel: input.channel,
    sourceKey: input.sourceKey,
  })
    .forNoKeyUpdate()
    .first();
  const newItem = !item;
  if (!item)
    item = await orm.public.RawItem.create({
      channel: input.channel,
      sourceKey: input.sourceKey,
      kind: input.kind,
      firstSeenAt: at,
      lastSeenAt: at,
      latestVersionId: null,
    });

  let version = await orm.public.RawItemVersion.where({
    rawItemId: item.id,
    contentHash: input.contentHash,
  }).first();
  const newVersion = !version;
  if (!version)
    version = await orm.public.RawItemVersion.create({
      rawItemId: item.id,
      contentHash: input.contentHash,
      payload: input.payload as Json,
      firstBatchId: input.batchId,
      firstSeenAt: at,
      lastSeenAt: at,
    });
  else if (at < version.firstSeenAt || at > version.lastSeenAt)
    await orm.public.RawItemVersion.where({ id: version.id }).updateAll({
      firstSeenAt: min(at, version.firstSeenAt),
      lastSeenAt: max(at, version.lastSeenAt),
    });

  const latest = await orm.public.RawItemVersion.where({ rawItemId: item.id })
    .orderBy((row) => row.lastSeenAt.desc())
    .orderBy((row) => row.createdAt.desc())
    .first();
  const latestVersionId = latest?.id ?? version.id;
  await orm.public.RawItem.where({ id: item.id }).updateAll({
    firstSeenAt: min(at, item.firstSeenAt),
    lastSeenAt: max(at, item.lastSeenAt),
    latestVersionId,
  });

  const attribution = input.queryId ?? NO_QUERY;
  const seen = await orm.public.RawItemSighting.where({
    batchId: input.batchId,
    rawItemId: item.id,
    attribution,
  }).first();
  if (!seen)
    await orm.public.RawItemSighting.create({
      batchId: input.batchId,
      rawItemId: item.id,
      versionId: version.id,
      queryId: input.queryId,
      attribution,
      rank: input.rank,
      observedAt: at,
    });

  return { rawItemId: item.id, newItem, newVersion };
}
