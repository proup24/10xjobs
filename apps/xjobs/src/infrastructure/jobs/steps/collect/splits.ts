import type { QuerySearchBuilderRow } from 'src/database';
import { type SearchSegment, segmentHash } from 'src/modules/segments';

/** A remembered split hasn't been made smaller before it is this old. */
const KEEP_SPLIT_MS = 60 * 60_000;
/** Searches that all return under this share of their row limit are small. */
const SMALL_SHARE = 0.25;

/** What one tick did with a LinkedIn job board group. */
export interface GroupTick {
  /** The group's segment key, the key of its remembered split. */
  groupKey: string;
  /** Segments the group ended the tick with, split pieces included. */
  chunks: number;
  /** A full search of the group was halved in this tick. */
  split: boolean;
  /** Most rows returned by a run that ended a branch (not full, or at the ceiling). */
  maxReturned: number;
  /** Rows one search may return by default. */
  rowLimit: number;
}

function byHash(a: QuerySearchBuilderRow, b: QuerySearchBuilderRow): number {
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/** The segment's members by hash order, cut in two, the first half rounded up. */
export function halve(segment: SearchSegment): [SearchSegment, SearchSegment] {
  const members = [...segment.members].sort(byHash);
  const half = Math.ceil(members.length / 2);
  const piece = (part: QuerySearchBuilderRow[]): SearchSegment => ({
    ...segment,
    members: part,
    hash: segmentHash(
      segment.key,
      part.map(({ id }) => id),
    ),
  });
  return [piece(members.slice(0, half)), piece(members.slice(half))];
}

/**
 * The parts to remember for a group after a tick, or null for no change. A
 * split in this tick that made more chunks than remembered is stored. A split
 * at least an hour old is halved once every search ran under a quarter of its
 * row limit; 1 forgets it.
 */
export function nextParts(
  current: { parts: number; splitAt: Date } | undefined,
  tick: GroupTick,
  now: Date,
): number | null {
  const parts = current?.parts ?? 1;
  if (tick.split) return tick.chunks > parts ? tick.chunks : null;
  if (!current) return null;
  const small = tick.maxReturned < tick.rowLimit * SMALL_SHARE;
  const old = now.getTime() - current.splitAt.getTime() >= KEEP_SPLIT_MS;
  if (!small || !old) return null;
  const smaller = Math.max(1, Math.floor(parts / 2));
  return smaller === parts ? null : smaller;
}
