import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type RawItemRow } from 'src/database';
import { linkJob } from '../repositories/jobs.writer';
import { inRetriedTransaction } from '../repositories/raw.repository';

const PAGE = 500;

/**
 * Rebuilds every normalized job from raw storage at the current normalizer
 * version: re-normalizes each raw item's latest version, re-links and
 * re-merges. Never changes processing status, so a rebuild sends nothing to
 * Process. Run after a `NORMALIZER_VERSION` bump: `pnpm db:renormalize`.
 */
@Injectable()
export class RenormalizeService {
  constructor(private readonly database: DatabaseService) {}

  async run(): Promise<{ items: number; invalid: number; jobs: number }> {
    let items = 0;
    let invalid = 0;
    let after: string | null = null;
    for (;;) {
      const page: RawItemRow[] = await this.page(after);
      if (page.length === 0) break;
      for (const item of page) {
        after = item.id;
        if (!item.latestVersionId) continue;
        const latestVersionId = item.latestVersionId;
        items += 1;
        const outcome = await inRetriedTransaction(this.database, (tx) =>
          linkJob(tx, {
            rawItemId: item.id,
            channel: item.channel as Channel,
            sourceKey: item.sourceKey,
            latestVersionId,
            observedAt: item.lastSeenAt,
            rebuild: true,
          }),
        );
        if ('invalid' in outcome) invalid += 1;
      }
    }
    const jobs = await this.database.db.orm.public.NormalizedJob.where({
      status: 'active',
    }).all();
    return { items, invalid, jobs: jobs.length };
  }

  /** The next raw items by id, after the given one. */
  private async page(after: string | null): Promise<RawItemRow[]> {
    const rawItems = this.database.db.orm.public.RawItem;
    const query =
      after === null
        ? rawItems.where({})
        : rawItems.where((row) => row.id.gt(after));
    return await query
      .orderBy((row) => row.id.asc())
      .limit(PAGE)
      .all();
  }
}
