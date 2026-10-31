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

function retryable(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 10 && current && typeof current === 'object';
    depth++
  ) {
    const state =
      (current as { sqlState?: string; code?: string }).sqlState ??
      (current as { code?: string }).code;
    if (state && ['23505', '40001', '40P01'].includes(state)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

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
        if (attempt >= 3 || !retryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
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
    const newer = !existing || observedAt > existing.lastSeenAt;
    const atsPostingId = await this.resolveAtsPostingId(
      tx,
      item,
      existing,
      newer,
    );
    const { row, outcome } = await this.upsertRawJob(
      tx,
      item,
      existing,
      atsPostingId,
      observedAt,
      newer,
    );

    await this.syncIdentities(tx, item.channel, row.id, aliases, found);
    await this.recordQueryHit(tx, queryId, row.id, item, observedAt);

    return { id: row.id, outcome };
  }

  private async findExistingJob(
    tx: DatabaseTransaction,
    channel: Channel,
    externalId: string | null,
    aliases: { identityType: string; identityValue: string }[],
  ): Promise<{
    existing: RawJobRow | null;
    found: { identityType: string; identityValue: string; rawJobId: string }[];
  }> {
    const found = [];
    for (const alias of aliases) {
      const match = await tx.orm.public.RawJobIdentity.where({
        channel,
        ...alias,
      }).first();
      if (match) found.push(match);
    }
    const ids = new Set(found.map((alias) => alias.rawJobId));
    if (ids.size > 1) {
      throw new IngestIdentityConflict(
        'Source ID and URL belong to different jobs',
      );
    }
    const [existingId] = ids;
    if (!existingId) {
      return { existing: null, found };
    }
    // NO KEY UPDATE serializes snapshots without blocking FK checks from attribution inserts.
    const existing = await tx.orm.public.RawJob.where({ id: existingId })
      .forNoKeyUpdate()
      .first();
    if (!existing) {
      throw new IngestIdentityConflict('Identity target no longer exists');
    }
    if (
      existing.externalId &&
      externalId &&
      existing.externalId !== externalId
    ) {
      throw new IngestIdentityConflict(
        'URL already belongs to another source ID',
      );
    }
    return { existing, found };
  }

  private async resolveAtsPostingId(
    tx: DatabaseTransaction,
    item: NormalizedJob,
    existing: RawJobRow | null,
    newer: boolean,
  ): Promise<string | null> {
    if (!newer) {
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

  private async upsertRawJob(
    tx: DatabaseTransaction,
    item: NormalizedJob,
    existing: RawJobRow | null,
    atsPostingId: string | null,
    observedAt: Date,
    newer: boolean,
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

    const firstSeenAt =
      observedAt < existing.firstSeenAt ? observedAt : existing.firstSeenAt;
    const updates = newer
      ? { ...snapshot(item), atsPostingId, lastSeenAt: observedAt }
      : {};

    const updated = await tx.orm.public.RawJob.where({
      id: existing.id,
    }).update({
      ...updates,
      // Identity enrichment is safe even for an older observation; identities never regress to null.
      externalId: existing.externalId ?? item.externalId,
      firstSeenAt,
    });
    if (!updated) {
      throw new Error('Job disappeared during ingestion');
    }
    return { row: updated, outcome: newer ? 'updated' : 'duplicate' };
  }

  private async syncIdentities(
    tx: DatabaseTransaction,
    channel: Channel,
    rawJobId: string,
    aliases: { identityType: string; identityValue: string }[],
    found: { identityType: string; identityValue: string }[],
  ): Promise<void> {
    for (const alias of aliases) {
      const exists = found.some(
        (entry) =>
          entry.identityType === alias.identityType &&
          entry.identityValue === alias.identityValue,
      );
      if (!exists) {
        await tx.orm.public.RawJobIdentity.create({
          channel,
          ...alias,
          rawJobId,
        });
      }
    }
  }

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
      const firstSeenAt =
        observedAt < hit.firstSeenAt ? observedAt : hit.firstSeenAt;
      const latestData =
        observedAt > hit.lastSeenAt
          ? {
              lastSeenAt: observedAt,
              observedUrl: item.observedUrl,
              rank: item.rank,
            }
          : {};

      await tx.orm.public.RawJobQueryHit.where({ id: hit.id }).update({
        firstSeenAt,
        ...latestData,
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
