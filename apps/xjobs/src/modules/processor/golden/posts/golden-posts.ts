import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PostDetail } from '../../../ingest/normalize/record';
import type { ApplyKind, Verdict } from '../../schema/post-extraction';
import type { GoldenFacts } from '../golden';

/** What a human (or Claude's draft) says one role of a hiring post is. */
export interface PostGoldenRole {
  title: string;
  employer: string | null;
  applyKinds: ApplyKind[];
  contactEmail: string | null;
  facts: Partial<GoldenFacts>;
  /** A role counts only once a human sets `reviewed: true`. */
  reviewed: boolean;
}

/** One real LinkedIn post and the labels Extract is scored against. */
export interface PostGoldenCase {
  /** The raw item id of the sample row this case was built from. */
  rawItemId: string;
  /** The post as Extract sees it (one entry per post object). */
  sources: PostDetail[];
  /** A verdict counts only once a human sets `reviewed: true`. */
  verdict: { value: Verdict; reason: string; reviewed: boolean };
  roles: PostGoldenRole[];
  /** The owner's note, or the pre-label description for an unreviewed case. */
  note: string | null;
}

export const POST_GOLDEN_FILE = join(__dirname, 'cases.json');

/** Every post golden case, in sample order. */
export function loadPostGolden(
  file: string = POST_GOLDEN_FILE,
): PostGoldenCase[] {
  return JSON.parse(readFileSync(file, 'utf8')) as PostGoldenCase[];
}
