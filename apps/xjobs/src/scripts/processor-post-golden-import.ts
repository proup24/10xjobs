/**
 * Builds `modules/processor/golden/posts/cases.json` from the labelled post
 * sample:
 *
 *   pnpm --filter @xjobs/xjobs processor:post-golden-import
 *
 * Each payload goes through the ingest posts mapper's own detail builder, so
 * Extract sees what production sees. Posts the drop rules would stop are kept,
 * since they test Extract too. Roles stay empty until the label session.
 * Re-running rewrites the file from the sample.
 */
import { writeFileSync } from 'node:fs';
import { cleanPostText } from 'src/modules/ingest/normalize/posts/clean';
import { readPostPayload } from 'src/modules/ingest/normalize/posts/payload';
import { postDetailOf } from 'src/modules/ingest/normalize/mappers/linkedin-post.mapper';
import { httpUrl } from 'src/modules/ingest/normalize/linkedin';
import sample from 'src/modules/ingest/normalize/posts/sample/sample.json';
import {
  POST_GOLDEN_FILE,
  type PostGoldenCase,
} from 'src/modules/processor/golden/posts/golden-posts';

type Entry = {
  rawItemId: string;
  payload: Record<string, unknown>;
  label: 'hiring' | 'not_hiring' | 'unsure';
  note: string;
};

type Verdict = PostGoldenCase['verdict'];

/** Owner-noted rows: the verdict each owner note supports (reviewed). */
const OWNER: Record<number, Omit<Verdict, 'reviewed'>> = {
  11: { value: 'junk', reason: 'no_clear_employer' },
  13: { value: 'junk', reason: 'messaging_group' },
  16: { value: 'junk', reason: 'funnel' },
  32: { value: 'junk', reason: 'many_roles_across_companies' },
  63: { value: 'not_hiring', reason: 'job_digest' },
  81: { value: 'junk', reason: 'funnel' },
  86: { value: 'junk', reason: 'funnel' },
  105: { value: 'hiring', reason: 'hiring' },
  106: { value: 'junk', reason: 'no_clear_employer' },
  113: { value: 'hiring', reason: 'hiring' },
};

/** The reason a not-hiring pre-label note most plainly supports. */
function notHiringReason(note: string): string {
  // Bench-sales hotlists have no listed reason of their own.
  if (/bench sales|hotlist/i.test(note)) return 'other';
  if (
    /open to|opentowork|exploring|seeking|looking for|recherche d|candidate promo/i.test(
      note,
    )
  )
    return 'open_to_work';
  if (/digest|job-platform|job platform|aggregat/i.test(note))
    return 'job_digest';
  if (/course|training|bootcamp/i.test(note)) return 'course_or_training_ad';
  if (/advice|commentary|opinion|tips|reflection/i.test(note))
    return 'advice_or_commentary';
  return 'other';
}

function verdictOf(i: number, e: Entry): Verdict {
  const owner = OWNER[i];
  if (owner) return { ...owner, reviewed: true };
  if (e.note.startsWith('owner:'))
    throw new Error(`owner-noted row #${i} has no mapping`);
  if (e.label === 'hiring')
    return { value: 'hiring', reason: 'hiring', reviewed: false };
  if (e.label === 'not_hiring')
    return {
      value: 'not_hiring',
      reason: notHiringReason(e.note),
      reviewed: false,
    };
  throw new Error(`unsure row #${i} has no mapping`);
}

function main(): void {
  const cases: PostGoldenCase[] = (sample as Entry[]).map((e, i) => {
    const raw = readPostPayload(e.payload);
    const url = raw.url ? httpUrl(raw.url)?.toString() : null;
    if (!raw.id || !url) throw new Error(`row #${i} has no id or link`);
    const ownText = cleanPostText(raw.text ?? '');
    const originalText = raw.original
      ? cleanPostText(raw.original.text ?? '')
      : '';
    return {
      rawItemId: e.rawItemId,
      sources: [postDetailOf(raw, raw.id, url, ownText, originalText)],
      verdict: verdictOf(i, e),
      roles: [],
      note: e.note,
    };
  });
  writeFileSync(POST_GOLDEN_FILE, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`wrote ${cases.length} cases to ${POST_GOLDEN_FILE}`);
}

main();
