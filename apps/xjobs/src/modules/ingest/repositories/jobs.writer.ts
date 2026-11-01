import type { Channel } from 'src/common/enums';
import type { NormalizedJobRow, RawItemVersionRow } from 'src/database';
import type { DatabaseTransaction } from 'src/database/seeds/seed.interface';
import {
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
  | { jobId: string; created: boolean; reopened: boolean };

export interface LinkJobInput {
  rawItemId: string;
  channel: Channel;
  sourceKey: string;
  /** The raw item's latest version: the job link always follows it. */
  latestVersionId: string;
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

/** The normalized row of a raw version at the current normalizer version. */
async function normalizedVersion(tx: DatabaseTransaction, input: LinkJobInput) {
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
    const version = versions.find((v) => v.id === link.normalizedVersionId)!;
    const raw = rawVersions.find((r) => r.id === version.rawVersionId)!;
    const item = items.find((i) => i.id === link.rawItemId)!;
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
  const version = await normalizedVersion(tx, input);
  if (version.status !== 'valid' || !version.jobKey || !version.record)
    return { invalid: version.reason ?? 'normalize: invalid' };
  const record = version.record as unknown as NormalizedRecord;

  let job = await orm.public.NormalizedJob.where({ jobKey: version.jobKey })
    .forNoKeyUpdate()
    .first();
  const created = !job;
  if (!job)
    job = await orm.public.NormalizedJob.create({
      jobKey: version.jobKey,
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
    const old = (await orm.public.NormalizedJob.where({ id: link.jobId })
      .forNoKeyUpdate()
      .first())!;
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
  };
}
