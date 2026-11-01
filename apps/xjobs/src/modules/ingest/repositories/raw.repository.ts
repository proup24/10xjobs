import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import {
  type CollectionBatchRow,
  DatabaseService,
  isRetryableTransactionError,
  type RawItemVersionRow,
} from 'src/database';
import type { DatabaseTransaction } from 'src/database/seeds/seed.interface';
import type { BatchReport, BatchStatus } from '../types';

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

/** Stores raw items and moves collection batches through their statuses. */
export abstract class RawStorageRepository {
  abstract findBatch(id: string): Promise<BatchRecord | null>;
  /** One transaction per item; saving the same item again writes nothing new. */
  abstract saveItem(
    input: SaveItemInput,
  ): Promise<{ newItem: boolean; newVersion: boolean }>;
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

  async saveItem(
    input: SaveItemInput,
  ): Promise<{ newItem: boolean; newVersion: boolean }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.db.transaction((tx) => save(tx, input));
      } catch (error) {
        // A uniqueness race lost the whole transaction: re-run it from the start.
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
      .where((row) => row.createdAt.lt(olderThan))
      .orderBy((row) => row.createdAt.asc())
      .limit(limit)
      .all();
    return rows.map((row) => row.id);
  }
}

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
): Promise<{ newItem: boolean; newVersion: boolean }> {
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
  await orm.public.RawItem.where({ id: item.id }).updateAll({
    firstSeenAt: min(at, item.firstSeenAt),
    lastSeenAt: max(at, item.lastSeenAt),
    latestVersionId: latest?.id ?? version.id,
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

  return { newItem, newVersion };
}
