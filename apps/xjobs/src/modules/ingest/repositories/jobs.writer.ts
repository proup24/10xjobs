import type { Channel } from 'src/common/enums';
import type { NormalizedJobRow, RawItemVersionRow } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import {
  isStrongJobKey,
  jobKey,
  type MergeSource,
  mergeSources,
  nextProcessing,
  normalize,
  NORMALIZER_VERSION,
  type NormalizedRecord,
  type ProcessingState,
} from '../normalize';
import { upsertCompany } from './companies.writer';

/** What linking one raw item to its job did. */
export type LinkOutcome =
  | { invalid: string }
  | {
      jobId: string;
      created: boolean;
      reopened: boolean;
      /** The job is `pending` for Process after this link (new, reopened, or still waiting). */
      pending: boolean;
    };

export interface LinkJobInput {
  rawItemId: string;
  observedAt: Date;
  /** True when rebuilding: links and fields change, processing status never does. */
  rebuild: boolean;
}

type Json = RawItemVersionRow['payload'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const JSONB = 'pg/jsonb@1';
type JobPatch = Partial<Omit<NormalizedJobRow, 'id'>>;

const min = (a: Date, b: Date) => (a < b ? a : b);
const max = (a: Date, b: Date) => (a > b ? a : b);

function processingOf(job: NormalizedJobRow): ProcessingState {
  return {
    status: job.processingStatus as ProcessingState['status'],
    reason: job.processingReason as ProcessingState['reason'],
    requestedAt: job.processingRequestedAt,
  };
}

function processingColumns(state: ProcessingState): JobPatch {
  return {
    processingStatus: state.status,
    processingReason: state.reason,
    processingRequestedAt: state.requestedAt,
    ...(state.status === 'pending'
      ? { processingAttempts: 0, processingError: null }
      : {}),
  };
}

function sameProcessing(a: ProcessingState, b: ProcessingState): boolean {
  return (
    a.status === b.status &&
    a.reason === b.reason &&
    a.requestedAt?.getTime() === b.requestedAt?.getTime()
  );
}

/** The job's field columns, from its merged record. */
function fieldColumns(record: NormalizedRecord): JobPatch {
  const round = (n: number | null | undefined) =>
    n === null || n === undefined ? null : Math.round(n);
  return {
    kind: record.kind,
    title: record.title,
    companyName: record.companyName,
    companyUrl: record.companyUrl,
    location: record.location,
    contractType: record.contractType,
    experienceLevel: record.experienceLevel,
    sector: record.sector,
    salaryText: record.salary?.text ?? null,
    salaryMin: round(record.salary?.min),
    salaryMax: round(record.salary?.max),
    salaryCurrency: record.salary?.currency ?? null,
    salaryPeriod: record.salary?.period ?? null,
    salaryProvidedByEmployer: record.salary?.providedByEmployer ?? null,
    publishedAt: record.publishedAt,
    postedAt: record.postedAt ? new Date(record.postedAt) : null,
    descriptionHtml: record.descriptionHtml,
    descriptionText: record.descriptionText,
    applyUrl: record.applyUrl,
    postingUrl: record.postingUrl,
    posterName: record.poster?.name ?? null,
    posterProfileUrl: record.poster?.profileUrl ?? null,
    posterType: record.poster?.type ?? null,
    workplaceType: record.workplaceType,
    remoteAllowed: record.remoteAllowed,
    employmentType: record.employmentType,
    countryCode: record.countryCode,
    regionCode: record.regionCode,
    city: record.city,
    state: record.state,
    geoId: record.geoId,
    applicantTrackingSystem: record.applicantTrackingSystem,
    applicantCount: record.applicantCount,
    expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    listingState: record.listingState,
    closed: record.closed,
  };
}

function found<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null)
    throw new Error(`normalized job: missing ${what}`);
  return value;
}

/** The normalized row of a raw version at the current normalizer version. */
async function normalizedVersion(
  tx: DatabaseTransaction,
  input: { latestVersionId: string; channel: Channel; sourceKey: string },
) {
  const { orm } = tx;
  const found = await orm.public.NormalizedVersion.where({
    rawVersionId: input.latestVersionId,
    normalizerVersion: NORMALIZER_VERSION,
  }).first();
  if (found) return found;
  const raw = await orm.public.RawItemVersion.where({
    id: input.latestVersionId,
  }).first();
  // The version's first sighting is the scrape that produced its stored text.
  const result = normalize(input.channel, raw?.payload, {
    scrapedAt: raw?.firstSeenAt ?? new Date(0),
  });
  return orm.public.NormalizedVersion.create({
    rawVersionId: input.latestVersionId,
    normalizerVersion: NORMALIZER_VERSION,
    ...('invalid' in result
      ? {
          status: 'invalid',
          reason: result.invalid,
          record: null,
          jobKey: null,
        }
      : {
          status: 'valid',
          reason: null,
          record: result.record as unknown as Json,
          jobKey: jobKey(input.channel, input.sourceKey, result.record),
        }),
  });
}

/**
 * Rewrites a job's fields and seen times from its current sources. Seen times
 * are those of its raw items, so they stay correct after moves and rebuilds.
 */
async function remerge(tx: DatabaseTransaction, jobId: string): Promise<void> {
  const { orm } = tx;
  const links = await orm.public.NormalizedJobSource.where({ jobId }).all();
  if (links.length === 0) return;
  const versions = await orm.public.NormalizedVersion.where((row) =>
    row.id.in(links.map((l) => l.normalizedVersionId)),
  ).all();
  const rawVersions = await orm.public.RawItemVersion.where((row) =>
    row.id.in(versions.map((v) => v.rawVersionId)),
  ).all();
  const items = await orm.public.RawItem.where((row) =>
    row.id.in(links.map((l) => l.rawItemId)),
  ).all();

  const merge: MergeSource[] = links.map((link) => {
    const version = found(
      versions.find((v) => v.id === link.normalizedVersionId),
      'normalized version',
    );
    const raw = found(
      rawVersions.find((r) => r.id === version.rawVersionId),
      'raw version',
    );
    const item = found(
      items.find((i) => i.id === link.rawItemId),
      'raw item',
    );
    return {
      rawItemId: link.rawItemId,
      channel: item.channel as Channel,
      record: version.record as unknown as NormalizedRecord,
      lastSeenAt: raw.lastSeenAt,
      createdAt: raw.createdAt,
    };
  });
  const merged = mergeSources(merge);
  // The company's facts are as recent as the source they came from.
  const companySource = merge.find(
    (s) => s.rawItemId === merged.fieldSources.company,
  );
  const companyId =
    merged.record.company && companySource
      ? await upsertCompany(tx, merged.record.company, companySource.lastSeenAt)
      : null;
  await orm.public.NormalizedJob.where({ id: jobId }).updateAll({
    ...fieldColumns(merged.record),
    companyId,
    fieldSources: merged.fieldSources as unknown as Json,
    firstSeenAt: items.map((i) => i.firstSeenAt).reduce(min),
    lastSeenAt: items.map((i) => i.lastSeenAt).reduce(max),
    normalizerVersion: NORMALIZER_VERSION,
  });
}

/**
 * The item's old job under its new key, when every source of that job now
 * keys there: a re-key renames the job, so it keeps its id, extraction,
 * processing state and every user's marks. Each other source's key comes from
 * its linked record by the item's own rule (jobKey, then effectiveKey). A job
 * with a source keyed elsewhere stays as it is. When a concurrent link created
 * the new key first, the rename's unique violation re-runs the link, which then
 * merges into that job.
 */
async function renamed(
  tx: DatabaseTransaction,
  jobId: string,
  rawItemId: string,
  key: string,
): Promise<NormalizedJobRow | null> {
  const { orm } = tx;
  const old = await orm.public.NormalizedJob.where({ id: jobId })
    .forNoKeyUpdate()
    .first();
  if (!old) return null;
  const others = await tx.query(
    tx.raw.sql`SELECT i.id, i.channel, i."sourceKey", i."latestVersionId",
        v.record
      FROM normalized_job_sources s
      JOIN normalized_versions v ON v.id = s."normalizedVersionId"
      JOIN raw_items i ON i.id = s."rawItemId"
      WHERE s."jobId" = ${jobId}::uuid AND s."rawItemId" <> ${rawItemId}::uuid`
      .returnsRow({
        id: UUID,
        channel: TEXT,
        sourceKey: TEXT,
        latestVersionId: UUID,
        record: JSONB,
      })
      .build(),
  );
  for (const other of others) {
    if (!other.record) return null;
    const item = {
      id: other.id as string,
      channel: other.channel as Channel,
      sourceKey: other.sourceKey as string,
      latestVersionId: other.latestVersionId as string | null,
    };
    const own = jobKey(
      item.channel,
      item.sourceKey,
      other.record as unknown as NormalizedRecord,
    );
    if ((await effectiveKey(tx, item, own)) !== key) return null;
  }
  await orm.public.NormalizedJob.where({ id: jobId }).updateAll({
    jobKey: key,
  });
  return { ...old, jobKey: key };
}

/**
 * Moves every user's decision on a job that merged away to the job it merged
 * into (viewed marks move too, see moveViews). A user with a decision on both
 * keeps one: applied beats dismissed beats expired, otherwise the newer
 * decision wins, and on a tie the target's stays.
 */
async function moveDecisions(
  tx: DatabaseTransaction,
  fromJobId: string,
  toJobId: string,
): Promise<void> {
  await tx.execute(
    tx.raw.sql`WITH moved AS (
        DELETE FROM public.job_decisions WHERE "jobId" = ${fromJobId}::uuid
        RETURNING "userId", status, reason, note, "decidedAt", "matchSnapshot"
      )
      INSERT INTO public.job_decisions
        ("userId", "jobId", status, reason, note, "decidedAt", "matchSnapshot")
      SELECT "userId", ${toJobId}::uuid, status, reason, note, "decidedAt", "matchSnapshot"
      FROM moved
      ON CONFLICT ("userId", "jobId") DO UPDATE SET
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        note = EXCLUDED.note,
        "decidedAt" = EXCLUDED."decidedAt",
        "matchSnapshot" = EXCLUDED."matchSnapshot",
        "updatedAt" = now()
      WHERE (CASE EXCLUDED.status WHEN 'applied' THEN 3 WHEN 'dismissed' THEN 2 ELSE 1 END)
          > (CASE job_decisions.status WHEN 'applied' THEN 3 WHEN 'dismissed' THEN 2 ELSE 1 END)
        OR ((CASE EXCLUDED.status WHEN 'applied' THEN 3 WHEN 'dismissed' THEN 2 ELSE 1 END)
          = (CASE job_decisions.status WHEN 'applied' THEN 3 WHEN 'dismissed' THEN 2 ELSE 1 END)
          AND EXCLUDED."decidedAt" > job_decisions."decidedAt")`
      .affectedCount()
      .build(),
  );
}

/**
 * Moves every user's viewed mark on a job that merged away to the job it
 * merged into. A user who viewed both keeps one row, at the earlier time: they
 * first saw the job then.
 */
async function moveViews(
  tx: DatabaseTransaction,
  fromJobId: string,
  toJobId: string,
): Promise<void> {
  await tx.execute(
    tx.raw.sql`WITH moved AS (
        DELETE FROM public.job_views WHERE "jobId" = ${fromJobId}::uuid
        RETURNING "userId", "viewedAt"
      )
      INSERT INTO public.job_views ("userId", "jobId", "viewedAt")
      SELECT "userId", ${toJobId}::uuid, "viewedAt" FROM moved
      ON CONFLICT ("userId", "jobId") DO UPDATE SET
        "viewedAt" = LEAST(job_views."viewedAt", EXCLUDED."viewedAt")`
      .affectedCount()
      .build(),
  );
}

/**
 * A merged job that revives gets a copy of the decisions it held when it
 * merged away (copyViewsBack does the same for viewed marks). They moved with
 * each merge, so they sit on the end of its mergedIntoId chain (followed at
 * most 10 steps, as in webhook_enqueue_match, stopping at a job that isn't
 * merged). Where the user already decided on the revived job, that decision
 * stays.
 */
async function copyDecisionsBack(
  tx: DatabaseTransaction,
  jobId: string,
): Promise<void> {
  await tx.execute(
    tx.raw.sql`WITH RECURSIVE chain AS (
        SELECT j.id, j.status, j."mergedIntoId", 0 AS depth
        FROM normalized_jobs j WHERE j.id = ${jobId}::uuid
        UNION ALL
        SELECT n.id, n.status, n."mergedIntoId", chain.depth + 1
        FROM chain JOIN normalized_jobs n ON n.id = chain."mergedIntoId"
        WHERE chain.status = 'merged' AND chain.depth < 10
      ), root AS (
        SELECT id FROM chain WHERE depth > 0 ORDER BY depth DESC LIMIT 1
      )
      INSERT INTO job_decisions
        ("userId", "jobId", status, reason, note, "decidedAt", "matchSnapshot")
      SELECT d."userId", ${jobId}::uuid, d.status, d.reason, d.note, d."decidedAt", d."matchSnapshot"
      FROM job_decisions d JOIN root ON d."jobId" = root.id
      ON CONFLICT DO NOTHING`
      .affectedCount()
      .build(),
  );
}

/**
 * A merged job that revives gets a copy of the viewed marks it held when it
 * merged away, taken from the end of its mergedIntoId chain as in
 * copyDecisionsBack. Where the user already viewed the revived job, that mark
 * stays.
 */
async function copyViewsBack(
  tx: DatabaseTransaction,
  jobId: string,
): Promise<void> {
  await tx.execute(
    tx.raw.sql`WITH RECURSIVE chain AS (
        SELECT j.id, j.status, j."mergedIntoId", 0 AS depth
        FROM normalized_jobs j WHERE j.id = ${jobId}::uuid
        UNION ALL
        SELECT n.id, n.status, n."mergedIntoId", chain.depth + 1
        FROM chain JOIN normalized_jobs n ON n.id = chain."mergedIntoId"
        WHERE chain.status = 'merged' AND chain.depth < 10
      ), root AS (
        SELECT id FROM chain WHERE depth > 0 ORDER BY depth DESC LIMIT 1
      )
      INSERT INTO job_views ("userId", "jobId", "viewedAt")
      SELECT v."userId", ${jobId}::uuid, v."viewedAt"
      FROM job_views v JOIN root ON v."jobId" = root.id
      ON CONFLICT DO NOTHING`
      .affectedCount()
      .build(),
  );
}

/**
 * The key the item links under. A scrape can drop a field the item had (a
 * LinkedIn rescrape with no apply URL), so a raw item never falls back from a
 * key naming the posting to its own id: when the latest version only yields a
 * fallback key, the most recent version with a posting key wins. Derived from
 * stored versions only, so a rebuild gives the same answer.
 */
async function effectiveKey(
  tx: DatabaseTransaction,
  item: {
    id: string;
    channel: string;
    sourceKey: string;
    latestVersionId: string | null;
  },
  latestKey: string,
): Promise<string> {
  if (isStrongJobKey(latestKey)) return latestKey;
  const versions = await tx.orm.public.RawItemVersion.where({
    rawItemId: item.id,
  })
    .orderBy((row) => row.lastSeenAt.desc())
    .orderBy((row) => row.createdAt.desc())
    .all();
  for (const raw of versions) {
    if (raw.id === item.latestVersionId) continue;
    const earlier = await normalizedVersion(tx, {
      latestVersionId: raw.id,
      channel: item.channel as Channel,
      sourceKey: item.sourceKey,
    });
    if (earlier.jobKey && isStrongJobKey(earlier.jobKey)) return earlier.jobKey;
  }
  return latestKey;
}

/**
 * Links a raw item to the job its latest version's job key names, inside the
 * raw item's transaction, and re-merges every job the link touched. A new key
 * with no job renames the item's old job when all its sources key there.
 * Sends the job to Process (`pending`) only when this observation creates it
 * or finds it after `reopenAfterMs` unseen. Idempotent: replaying changes
 * nothing.
 */
export async function linkJob(
  tx: DatabaseTransaction,
  input: LinkJobInput,
): Promise<LinkOutcome> {
  const { orm } = tx;
  // The raw item lock serializes every link of this item (ingest and rebuild),
  // and its latest version is read under it, so a link never follows a stale one.
  const item = await orm.public.RawItem.where({ id: input.rawItemId })
    .forNoKeyUpdate()
    .first();
  if (!item?.latestVersionId)
    return { invalid: 'normalize: raw item has no version' };
  const version = await normalizedVersion(tx, {
    latestVersionId: item.latestVersionId,
    channel: item.channel as Channel,
    sourceKey: item.sourceKey,
  });
  if (version.status !== 'valid' || !version.jobKey || !version.record)
    return { invalid: version.reason ?? 'normalize: invalid' };
  const record = version.record as unknown as NormalizedRecord;
  const key = await effectiveKey(tx, item, version.jobKey);

  const link = await orm.public.NormalizedJobSource.where({
    rawItemId: input.rawItemId,
  }).first();
  let job =
    (await orm.public.NormalizedJob.where({ jobKey: key })
      .forNoKeyUpdate()
      .first()) ??
    (link ? await renamed(tx, link.jobId, input.rawItemId, key) : null);
  const created = !job;
  if (!job)
    job = await orm.public.NormalizedJob.create({
      jobKey: key,
      kind: record.kind,
      status: 'active',
      mergedIntoId: null,
      postingUrl: record.postingUrl,
      closed: record.closed,
      fieldSources: {} as Json,
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
      normalizerVersion: NORMALIZER_VERSION,
    });
  else if (job.status === 'merged') {
    // A job whose sources all left gets one back: it is a job again, with a
    // copy of the decisions and views that moved away with it.
    if (job.mergedIntoId) {
      await copyDecisionsBack(tx, job.id);
      await copyViewsBack(tx, job.id);
    }
    await orm.public.NormalizedJob.where({ id: job.id }).updateAll({
      status: 'active',
      mergedIntoId: null,
    });
  }
  const before = job;
  let current = processingOf(before);
  const previousLastSeenAt: Date | null = created ? null : before.lastSeenAt;

  if (!link) {
    await orm.public.NormalizedJobSource.create({
      jobId: job.id,
      rawItemId: input.rawItemId,
      normalizedVersionId: version.id,
      linkedAt: input.observedAt,
    });
  } else if (link.jobId === job.id) {
    if (link.normalizedVersionId !== version.id)
      await orm.public.NormalizedJobSource.where({ id: link.id }).updateAll({
        normalizedVersionId: version.id,
      });
  } else {
    // The item's job key changed: it leaves its old job for this one.
    const old = found(
      await orm.public.NormalizedJob.where({ id: link.jobId })
        .forNoKeyUpdate()
        .first(),
      'previous job',
    );
    await orm.public.NormalizedJobSource.where({ id: link.id }).updateAll({
      jobId: job.id,
      normalizedVersionId: version.id,
      linkedAt: input.observedAt,
    });
    const left = await orm.public.NormalizedJobSource.where({
      jobId: old.id,
    }).all();
    if (left.length > 0) {
      await remerge(tx, old.id);
    } else {
      await orm.public.NormalizedJob.where({ id: old.id }).updateAll({
        status: 'merged',
        mergedIntoId: job.id,
        ...(old.processingStatus === 'pending'
          ? processingColumns({ status: null, reason: null, requestedAt: null })
          : {}),
      });
      await moveDecisions(tx, old.id, job.id);
      await moveViews(tx, old.id, job.id);
      const oldState = processingOf(old);
      if (oldState.status === 'pending' && current.status !== 'pending') {
        current = oldState;
        await orm.public.NormalizedJob.where({ id: job.id }).updateAll(
          processingColumns(oldState),
        );
      }
    }
  }

  await remerge(tx, job.id);

  const next = nextProcessing({
    created,
    previousLastSeenAt,
    observedAt: input.observedAt,
    current,
    rebuild: input.rebuild,
  });
  const changed = !sameProcessing(next, current);
  if (changed)
    await orm.public.NormalizedJob.where({ id: job.id }).updateAll(
      processingColumns(next),
    );
  return {
    jobId: job.id,
    created,
    reopened: changed && next.reason === 'reopened',
    pending: (changed ? next : current).status === 'pending',
  };
}
