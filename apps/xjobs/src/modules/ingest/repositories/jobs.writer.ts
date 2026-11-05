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
    publishedAt: record.publishedAt,
    descriptionHtml: record.descriptionHtml,
    descriptionText: record.descriptionText,
    applyUrl: record.applyUrl,
    postingUrl: record.postingUrl,
    posterName: record.poster?.name ?? null,
    posterProfileUrl: record.poster?.profileUrl ?? null,
    posterType: record.poster?.type ?? null,
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
  const result = normalize(input.channel, raw?.payload);
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
  await orm.public.NormalizedJob.where({ id: jobId }).updateAll({
    ...fieldColumns(merged.record),
    fieldSources: merged.fieldSources as unknown as Json,
    firstSeenAt: items.map((i) => i.firstSeenAt).reduce(min),
    lastSeenAt: items.map((i) => i.lastSeenAt).reduce(max),
    normalizerVersion: NORMALIZER_VERSION,
  });
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
 * raw item's transaction, and re-merges every job the link touched. Sends the
 * job to Process (`pending`) only when this observation creates it or finds
 * it after `reopenAfterMs` unseen. Idempotent: replaying changes nothing.
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

  let job = await orm.public.NormalizedJob.where({ jobKey: key })
    .forNoKeyUpdate()
    .first();
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
  else if (job.status === 'merged')
    // A job whose sources all left gets one back: it is a job again.
    await orm.public.NormalizedJob.where({ id: job.id }).updateAll({
      status: 'active',
      mergedIntoId: null,
    });
  const before = job;
  let current = processingOf(before);
  let previousLastSeenAt: Date | null = created ? null : before.lastSeenAt;
  let inherited = false;

  const link = await orm.public.NormalizedJobSource.where({
    rawItemId: input.rawItemId,
  }).first();
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
      const oldState = processingOf(old);
      if (created) {
        // Same job under a better key: it carries its processing state over.
        inherited = true;
        current = oldState;
        previousLastSeenAt = old.lastSeenAt;
        await orm.public.NormalizedJob.where({ id: job.id }).updateAll(
          processingColumns(oldState),
        );
      } else if (
        oldState.status === 'pending' &&
        current.status !== 'pending'
      ) {
        current = oldState;
        await orm.public.NormalizedJob.where({ id: job.id }).updateAll(
          processingColumns(oldState),
        );
      }
    }
  }

  await remerge(tx, job.id);

  const next = nextProcessing({
    created: created && !inherited,
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
    created: created && !inherited,
    reopened: changed && next.reason === 'reopened',
    pending: (changed ? next : current).status === 'pending',
  };
}
