import { Channel, isTrialChannel } from 'src/common/enums';
import {
  type NormalizedRecord,
  type PostDetail,
  RECORD_FIELDS,
} from './record';

/** One raw item's current normalized record, as a candidate for its job. */
export interface MergeSource {
  rawItemId: string;
  channel: Channel;
  record: NormalizedRecord;
  /** Of the raw version the record came from. */
  lastSeenAt: Date;
  createdAt: Date;
}

export interface MergedJob {
  record: NormalizedRecord;
  /** Which raw item each field's value came from. */
  fieldSources: Partial<Record<keyof NormalizedRecord, string>>;
  /** Every post source's details, originals first; null when no source is a post. */
  postSources: { sources: PostDetail[] } | null;
}

/**
 * The employer's own ATS posting first, then the LinkedIn job, then Indeed,
 * then a post. Indeed's place against the trial actors can't matter: a trial
 * actor always keys by LinkedIn id and never shares a job with Indeed.
 */
const precedence: Record<Channel, number> = {
  [Channel.ASHBY]: 1,
  [Channel.GREEN_HOUSE]: 1,
  [Channel.LINKEDIN_JOB_BOARD]: 2,
  [Channel.INDEED]: 2.5,
  // Trial actors rank below harvestapi in the planned order curious_coder 2.1,
  // bebity 2.2, cheap_scraper 2.4; they count only when no harvestapi source is
  // present (boardSources).
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: 2.4,
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: 2.2,
  [Channel.LINKEDIN_POSTS]: 3,
};

const isAts = (channel: Channel) => precedence[channel] === 1;

/**
 * The sources that count for a job: trial sources are dropped whenever a
 * harvestapi source is there, so a trial actor adds nothing to such a job.
 */
export function boardSources<T extends { channel: Channel }>(
  sources: T[],
): T[] {
  if (!sources.some((s) => s.channel === Channel.LINKEDIN_JOB_BOARD))
    return sources;
  return sources.filter((s) => !isTrialChannel(s.channel));
}

function compare(a: MergeSource, b: MergeSource): number {
  return (
    precedence[a.channel] - precedence[b.channel] ||
    b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.rawItemId < b.rawItemId ? -1 : a.rawItemId > b.rawItemId ? 1 : 0)
  );
}

/**
 * A post's details with the fields a record stored before them lacks filled
 * in: not truncated, nothing attached.
 */
export function withPostDefaults(post: PostDetail): PostDetail {
  return {
    ...post,
    truncated: post.truncated ?? false,
    attachedUrls: post.attachedUrls ?? [],
    original: post.original
      ? {
          ...post.original,
          truncated: post.original.truncated ?? false,
          attachedUrls: post.original.attachedUrls ?? [],
        }
      : null,
  };
}

/**
 * Every post source's details: originals first, then by posting time (unknown
 * last), then by raw item id. Null when no source is a post.
 */
export function mergePostSources(
  sources: MergeSource[],
): { sources: PostDetail[] } | null {
  // `!= null`: a record stored before the post field existed has no key at all.
  const posts = sources.filter(
    (s): s is MergeSource & { record: { post: PostDetail } } =>
      s.record.post != null,
  );
  if (posts.length === 0) return null;
  const rank = (s: (typeof posts)[number]) => (s.record.post.original ? 1 : 0);
  const time = (s: (typeof posts)[number]) =>
    s.record.post.postedAt ?? '\uffff';
  posts.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (time(a) < time(b) ? -1 : time(a) > time(b) ? 1 : 0) ||
      (a.rawItemId < b.rawItemId ? -1 : a.rawItemId > b.rawItemId ? 1 : 0),
  );
  return { sources: posts.map((s) => withPostDefaults(s.record.post)) };
}

/**
 * The job's record, field by field from the best source that states it. A
 * closed posting contributes only its flag; the job is closed when every ATS
 * posting behind it is.
 */
export function mergeSources(sources: MergeSource[]): MergedJob {
  if (sources.length === 0) throw new Error('a job needs at least one source');
  const ordered = [...boardSources(sources)].sort(compare);
  const open = ordered.filter((s) => !s.record.closed);
  const ats = ordered.filter((s) => isAts(s.channel));
  const first = ordered[0] as MergeSource;

  const record: Record<string, unknown> = {};
  const fieldSources: MergedJob['fieldSources'] = {};
  for (const field of RECORD_FIELDS) {
    if (field === 'kind') {
      record.kind = ordered.every((s) => s.record.kind === 'post')
        ? 'post'
        : 'job';
    } else if (field === 'closed') {
      record.closed = ats.length > 0 && ats.every((s) => s.record.closed);
    } else if (field === 'postedAt') {
      // The earliest known posting time among open sources.
      let from: MergeSource | undefined;
      for (const s of open)
        if (
          s.record.postedAt !== null &&
          (!from || s.record.postedAt < (from.record.postedAt as string))
        )
          from = s;
      record.postedAt = from ? from.record.postedAt : null;
      if (from) fieldSources.postedAt = from.rawItemId;
    } else if (field === 'postingUrl') {
      const from = open[0] ?? first;
      record.postingUrl = from.record.postingUrl;
      fieldSources.postingUrl = from.rawItemId;
    } else {
      const from = open.find((s) => s.record[field] != null);
      record[field] = !from
        ? null
        : field === 'post'
          ? withPostDefaults(from.record.post as PostDetail)
          : from.record[field];
      if (from) fieldSources[field] = from.rawItemId;
    }
  }
  return {
    record: record as NormalizedRecord,
    fieldSources,
    postSources: mergePostSources(sources),
  };
}
