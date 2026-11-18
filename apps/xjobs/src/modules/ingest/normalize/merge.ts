import { Channel } from 'src/common/enums';
import { type NormalizedRecord, RECORD_FIELDS } from './record';

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
}

/** The employer's own ATS posting first, then the LinkedIn job, then a post. */
const precedence: Record<Channel, number> = {
  [Channel.ASHBY]: 1,
  [Channel.GREEN_HOUSE]: 1,
  [Channel.LINKEDIN_JOB_BOARD]: 2,
  // Placeholder; final in Task 5.
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: 2.4,
  [Channel.LINKEDIN_POSTS]: 3,
};

const isAts = (channel: Channel) => precedence[channel] === 1;

function compare(a: MergeSource, b: MergeSource): number {
  return (
    precedence[a.channel] - precedence[b.channel] ||
    b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.rawItemId < b.rawItemId ? -1 : a.rawItemId > b.rawItemId ? 1 : 0)
  );
}

/**
 * The job's record, field by field from the best source that states it. A
 * closed posting contributes only its flag; the job is closed when every ATS
 * posting behind it is.
 */
export function mergeSources(sources: MergeSource[]): MergedJob {
  if (sources.length === 0) throw new Error('a job needs at least one source');
  const ordered = [...sources].sort(compare);
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
      const from = open.find((s) => s.record[field] !== null);
      record[field] = from ? from.record[field] : null;
      if (from) fieldSources[field] = from.rawItemId;
    }
  }
  return { record: record as NormalizedRecord, fieldSources };
}
