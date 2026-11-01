import { Injectable } from '@nestjs/common';
import { DatabaseService, type RawItemRow } from 'src/database';
import { linkJobSafely } from '../repositories/raw.repository';

const PAGE = 500;

export interface RenormalizeSummary {
  items: number;
  invalid: number;
  jobs: number;
}

async function page(
  database: Pick<DatabaseService, 'db'>,
  after: string | null,
): Promise<RawItemRow[]> {
  const rawItems = database.db.orm.public.RawItem;
  const query =
    after === null
      ? rawItems.where({})
      : rawItems.where((row) => row.id.gt(after));
  return await query
    .orderBy((row) => row.id.asc())
    .limit(PAGE)
    .all();
}

/**
 * Rebuilds every normalized job from raw storage at the current normalizer
 * version: re-normalizes each raw item's latest version, re-links and
 * re-merges. Never changes processing status, so a rebuild sends nothing to
 * Process. Safe while ingest runs: each item is linked under its row lock.
 */
export async function renormalizeJobs(
  database: Pick<DatabaseService, 'db'>,
): Promise<RenormalizeSummary> {
  let items = 0;
  let invalid = 0;
  let after: string | null = null;
  for (;;) {
    const rows: RawItemRow[] = await page(database, after);
    if (rows.length === 0) break;
    for (const item of rows) {
      after = item.id;
      items += 1;
      const outcome = await linkJobSafely(database, {
        rawItemId: item.id,
        observedAt: item.lastSeenAt,
        rebuild: true,
      });
      if ('invalid' in outcome) invalid += 1;
    }
  }
  const jobs = await database.db.orm.public.NormalizedJob.where({
    status: 'active',
  })
    .select('id')
    .all();
  return { items, invalid, jobs: jobs.length };
}

/** `renormalizeJobs` for Nest callers. */
@Injectable()
export class RenormalizeService {
  constructor(private readonly database: DatabaseService) {}

  run(): Promise<RenormalizeSummary> {
    return renormalizeJobs(this.database);
  }
}
