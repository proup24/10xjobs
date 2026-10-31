import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { RawJobRow } from 'src/database/models';
import type { DatabaseTransaction } from 'src/database/seeds/seed.interface';
import type { Channel } from 'src/common/enums';
import { identityAliases } from '../utils';
import {
  IngestIdentityConflict,
  type NormalizedJob,
  type SaveOutcome,
} from '../types';

export abstract class IngestRepository {
  abstract findQuery(
    id: string,
  ): Promise<{ id: string; channel: Channel } | null>;
  abstract save(
    queryId: string,
    item: NormalizedJob,
    observedAt: Date,
  ): Promise<SaveOutcome>;
}

type IdentityAlias = { identityType: string; identityValue: string };
type FoundIdentity = { identityType: string; identityValue: string; rawJobId: string };

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 10;

/** PostgreSQL error codes for concurrency and uniqueness conflicts that can be retried. */
const RETRYABLE_SQL_CODES = new Set([
  '23505', // unique_violation
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

function isRetryableError(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 10 && current && typeof current === 'object';
    depth++
  ) {
    const errorObj = current as { sqlState?: string; code?: string; cause?: unknown };
    const code = errorObj.sqlState ?? errorObj.code;
    if (code && RETRYABLE_SQL_CODES.has(code)) return true;
    current = errorObj.cause;
  }
  return false;
}

function earliestDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

/** Extracts scalar columns from a NormalizedJob matching RawJob table schema. */
function snapshot(item: NormalizedJob) {
  return {
    channel: item.channel,
    kind: item.kind,
    externalId: item.externalId,
    url: item.url,
    applyUrl: item.applyUrl,
    title: item.title,
    company: item.company,
    location: item.location,
    description: item.description,
    postedAt: item.postedAt,
    postedAtPrecision: item.postedAtPrecision,
    authorName: item.authorName,
    authorUrl: item.authorUrl,
    contactName: item.contactName,
    contactUrl: item.contactUrl,
    raw: item.raw as RawJobRow['raw'],
    normalizationVersion: item.normalizationVersion,
  };
}

@Injectable()
export class PrismaIngestRepository extends IngestRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async findQuery(
    id: string,
  ): Promise<{ id: string; channel: Channel } | null> {
    const row = await this.database.db.orm.public.QuerySearchBuilder.where({
      id,
    }).first();
    return row ? { id: row.id, channel: row.channel as Channel } : null;
  }

  async save(
    queryId: string,
    item: NormalizedJob,
    observedAt: Date,
  ): Promise<SaveOutcome> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.db.transaction((tx) =>
          this.saveItem(tx, queryId, item, observedAt),
        );
      } catch (error) {
        // Re-run the complete transaction: a uniqueness race must not leave a partially stored item.
        if (attempt >= MAX_TRANSACTION_RETRIES || !isRetryableError(error)) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt),
        );
      }
    }
  }

  private async saveItem(
    tx: DatabaseTransaction,
    queryId: string,
    item: NormalizedJob,
    observedAt: Date,
  ): Promise<SaveOutcome> {
    const aliases = identityAliases(item);
    const { existing, found } = await this.findExistingJob(
      tx,
      item.channel,
      item.externalId,
      aliases,
    );

    const isNewer = !existing || observedAt > existing.lastSeenAt;
    const atsPostingId = await this.resolveAtsPostingId(
      tx,
      item,
      existing,
      isNewer,
    );

    const { row, outcome } = await this.upsertRawJob(
      tx,
      item,
      existing,
      atsPostingId,
      observedAt,
      isNewer,
    );

    await this.syncIdentities(tx, item.channel, row.id, aliases, found);
    await this.recordQueryHit(tx, queryId, row.id, item, observedAt);

    return { id: row.id, outcome };
  }

  /**
   * Resolves existing job by looking up all identity aliases (e.g. source URL, source ID).
   * Validates that aliases resolve to at most one job and checks for conflicting external IDs.
   */
  private async findExistingJob(
    tx: DatabaseTransaction,
    channel: Channel,
    externalId: string | null,
    aliases: IdentityAlias[],
  ): Promise<{ existing: RawJobRow | null; found: FoundIdentity[] }> {
    const found: FoundIdentity[] = [];
    for (const alias of aliases) {
      const match = await tx.orm.public.RawJobIdentity.where({
        channel,
        ...alias,
      }).first();
      if (match) found.push(match);
    }

    const matchedJobIds = new Set(found.map((alias) => alias.rawJobId));
    if (matchedJobIds.size > 1) {
      throw new IngestIdentityConflict(
        'Source ID and URL belong to different jobs',
      );
    }

    const [existingId] = matchedJobIds;
    if (!existingId) {
      return { existing: null, found };
    }

    // NO KEY UPDATE serializes snapshots without blocking foreign-key checks from attribution inserts.
    const existing = await tx.orm.public.RawJob.where({ id: existingId })
      .forNoKeyUpdate()
      .first();

    if (!existing) {
      throw new IngestIdentityConflict('Identity target no longer exists');
    }

    const hasConflictingExternalId = Boolean(
      existing.externalId && externalId && existing.externalId !== externalId,
    );
    if (hasConflictingExternalId) {
      throw new IngestIdentityConflict(
        'URL already belongs to another source ID',
      );
    }

    return { existing, found };
  }

  /**
   * Resolves or creates an AtsPostingIdentity record if the item contains ATS identity
   * and represents the newest observation.
   */
  private async resolveAtsPostingId(
    tx: DatabaseTransaction,
    item: NormalizedJob,
    existing: RawJobRow | null,
    isNewer: boolean,
  ): Promise<string | null> {
    if (!isNewer) {
      return existing?.atsPostingId ?? null;
    }
    if (!item.ats) {
      return null;
    }
    const ats =
      (await tx.orm.public.AtsPostingIdentity.where(item.ats).first()) ??
      (await tx.orm.public.AtsPostingIdentity.create(item.ats));
    return ats.id;
  }

  /**
   * Inserts a new RawJob or updates an existing one, preserving monotonic timestamp invariants:
   * `firstSeenAt` tracks the earliest observation, and `lastSeenAt` tracks the latest observation.
   */
  private async upsertRawJob(
    tx: DatabaseTransaction,
    item: NormalizedJob,
    existing: RawJobRow | null,
    atsPostingId: string | null,
    observedAt: Date,
    isNewer: boolean,
  ): Promise<{ row: RawJobRow; outcome: SaveOutcome['outcome'] }> {
    if (!existing) {
      const row = await tx.orm.public.RawJob.create({
        ...snapshot(item),
        atsPostingId,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      });
      return { row, outcome: 'inserted' };
    }

    const updates = isNewer
      ? { ...snapshot(item), atsPostingId, lastSeenAt: observedAt }
      : {};

    const updated = await tx.orm.public.RawJob.where({
      id: existing.id,
    }).update({
      ...updates,
      // Identity enrichment is safe even for older observations; external ID never regresses to null.
      externalId: existing.externalId ?? item.externalId,
      firstSeenAt: earliestDate(observedAt, existing.firstSeenAt),
    });

    if (!updated) {
      throw new Error('Job disappeared during ingestion');
    }

    return { row: updated, outcome: isNewer ? 'updated' : 'duplicate' };
  }

  /**
   * Links any new identity aliases (such as newly discovered source ID) to the RawJob row.
   */
  private async syncIdentities(
    tx: DatabaseTransaction,
    channel: Channel,
    rawJobId: string,
    aliases: IdentityAlias[],
    found: FoundIdentity[],
  ): Promise<void> {
    for (const alias of aliases) {
      const alreadyExists = found.some(
        (entry) =>
          entry.identityType === alias.identityType &&
          entry.identityValue === alias.identityValue,
      );
      if (!alreadyExists) {
        await tx.orm.public.RawJobIdentity.create({
          channel,
          ...alias,
          rawJobId,
        });
      }
    }
  }

  /**
   * Records or updates attribution for this search query.
   */
  private async recordQueryHit(
    tx: DatabaseTransaction,
    queryId: string,
    rawJobId: string,
    item: NormalizedJob,
    observedAt: Date,
  ): Promise<void> {
    const hit = await tx.orm.public.RawJobQueryHit.where({
      queryId,
      rawJobId,
    }).first();

    if (hit) {
      const isNewerObservation = observedAt > hit.lastSeenAt;
      await tx.orm.public.RawJobQueryHit.where({ id: hit.id }).update({
        firstSeenAt: earliestDate(observedAt, hit.firstSeenAt),
        ...(isNewerObservation
          ? {
              lastSeenAt: observedAt,
              observedUrl: item.observedUrl,
              rank: item.rank,
            }
          : {}),
      });
      return;
    }

    await tx.orm.public.RawJobQueryHit.create({
      queryId,
      rawJobId,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      observedUrl: item.observedUrl,
      rank: item.rank,
    });
  }
}
