/**
 * Builds the golden review sheet from a listing eval report (slice 03 Part 5):
 *
 *   pnpm --filter @xjobs/xjobs processor:golden-review -- --report <last-report json> --out <md path> [--confirm]
 *
 * Lists, numbered in batches of 25, every label a human must read: each eval
 * value that differs from a counted label, every `requirements` draft still
 * unreviewed, and each new-label draft the eval disagrees with or has no
 * answer for. `--confirm` also marks the drafts the eval agrees with
 * `reviewed: true` in the case files. Reads files only; no model call.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOLDEN_CASES_DIR,
  type GoldenCase,
  loadGolden,
} from 'src/modules/processor/golden/golden';
import {
  agreements,
  confirm,
  renderReview,
  reviewItems,
} from 'src/modules/processor/golden/review';
import type { ListingReportFile } from 'src/modules/processor/golden/score';

const USAGE =
  'usage: processor:golden-review -- --report <last-report json> --out <md path> [--confirm]';

function parseArgs(raw: readonly string[]) {
  const argv = raw[0] === '--' ? raw.slice(1) : raw;
  let report: string | undefined;
  let out: string | undefined;
  let doConfirm = false;
  const path = (flag: string, v: string | undefined): string => {
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a path`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--report') report = path(arg, argv[++i]);
    else if (arg === '--out') out = path(arg, argv[++i]);
    else if (arg === '--confirm') doConfirm = true;
    else throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  if (!report || !out) throw new Error(USAGE);
  return { report, out, confirm: doConfirm };
}

/** Case file names by case id (files are not always named after the id). */
function caseFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of readdirSync(GOLDEN_CASES_DIR).filter((n) =>
    n.endsWith('.json'),
  )) {
    const c = JSON.parse(
      readFileSync(join(GOLDEN_CASES_DIR, f), 'utf8'),
    ) as GoldenCase;
    files.set(c.id, f);
  }
  return files;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = JSON.parse(
    readFileSync(args.report, 'utf8'),
  ) as ListingReportFile;
  if (!Array.isArray(report.scores))
    throw new Error(
      `${args.report} has no per-case scores; re-run processor:eval to write them`,
    );
  const cases = loadGolden();
  const items = reviewItems(report, cases);
  writeFileSync(args.out, renderReview(items));
  console.log(`${items.length} items written to ${args.out}`);
  const agreed = agreements(report);
  if (!args.confirm) {
    console.log(
      `${agreed.length} drafts agree with the eval; --confirm marks them reviewed`,
    );
    return;
  }
  const files = caseFiles();
  for (const c of confirm(cases, agreed)) {
    const file = files.get(c.id);
    if (!file) throw new Error(`no file for case ${c.id}`);
    writeFileSync(
      join(GOLDEN_CASES_DIR, file),
      `${JSON.stringify(c, null, 2)}\n`,
    );
  }
  console.log(`${agreed.length} drafts confirmed (reviewed: true)`);
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
