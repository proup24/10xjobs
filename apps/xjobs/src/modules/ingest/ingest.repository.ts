import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { RawJobRow } from 'src/database/models';
import type { DatabaseTransaction } from 'src/database/seeds/seed.interface';
import type { Channel } from 'src/common/enums';
import { identityAliases } from './identity';
import {
  IngestIdentityConflict,
  type NormalizedJob,
  type SaveOutcome,
} from './types';

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
  const {
    ats: _ats,
    rank: _rank,
    observedUrl: _observedUrl,
    ...columns
  } = item;
  return { ...columns, raw: columns.raw as RawJobRow['raw'] };
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
    const found = [];
    for (const alias of aliases) {
      const existing = await tx.orm.public.RawJobIdentity.where({
        channel: item.channel,
        ...alias,
      }).first();
      if (existing) found.push(existing);
    }
    const ids = new Set(found.map((alias) => alias.rawJobId));
    if (ids.size > 1)
      throw new IngestIdentityConflict(
        'Source ID and URL belong to different jobs',
      );
    const existingId = [...ids][0];
    // NO KEY UPDATE serializes snapshots without blocking FK checks from attribution inserts.
    const existing = existingId
      ? await tx.orm.public.RawJob.where({ id: existingId })
          .forNoKeyUpdate()
          .first()
      : null;
    if (existingId && !existing)
      throw new IngestIdentityConflict('Identity target no longer exists');
    if (
      existing &&
      existing.externalId &&
      item.externalId &&
      existing.externalId !== item.externalId
    ) {
      throw new IngestIdentityConflict(
        'URL already belongs to another source ID',
      );
    }
    const newer = !existing || observedAt > existing.lastSeenAt;
    let atsPostingId = existing?.atsPostingId ?? null;
    if (newer) {
      atsPostingId = null;
      if (item.ats) {
        const ats =
          (await tx.orm.public.AtsPostingIdentity.where(item.ats).first()) ??
          (await tx.orm.public.AtsPostingIdentity.create(item.ats));
        atsPostingId = ats.id;
      }
    }
    let row: RawJobRow;
    let outcome: SaveOutcome['outcome'];
    if (!existing) {
      row = await tx.orm.public.RawJob.create({
        ...snapshot(item),
        atsPostingId,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      });
      outcome = 'inserted';
    } else {
      const updated = await tx.orm.public.RawJob.where({
        id: existing.id,
      }).update({
        ...(newer
          ? { ...snapshot(item), atsPostingId, lastSeenAt: observedAt }
          : {}),
        // Identity enrichment is safe even for an older observation; identities never regress to null.
        externalId: existing.externalId ?? item.externalId,
        firstSeenAt:
          observedAt < existing.firstSeenAt ? observedAt : existing.firstSeenAt,
      });
      if (!updated) throw new Error('Job disappeared during ingestion');
      row = updated;
      outcome = newer ? 'updated' : 'duplicate';
    }
    for (const alias of aliases) {
      if (
        !found.some(
          (entry) =>
            entry.identityType === alias.identityType &&
            entry.identityValue === alias.identityValue,
        )
      ) {
        await tx.orm.public.RawJobIdentity.create({
          channel: item.channel,
          ...alias,
          rawJobId: row.id,
        });
      }
    }
    const hit = await tx.orm.public.RawJobQueryHit.where({
      queryId,
      rawJobId: row.id,
    }).first();
    if (hit) {
      await tx.orm.public.RawJobQueryHit.where({ id: hit.id }).update({
        firstSeenAt:
          observedAt < hit.firstSeenAt ? observedAt : hit.firstSeenAt,
        ...(observedAt > hit.lastSeenAt
          ? {
              lastSeenAt: observedAt,
              observedUrl: item.observedUrl,
              rank: item.rank,
            }
          : {}),
      });
    } else {
      await tx.orm.public.RawJobQueryHit.create({
        queryId,
        rawJobId: row.id,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        observedUrl: item.observedUrl,
        rank: item.rank,
      });
    }
    return { id: row.id, outcome };
  }
}
