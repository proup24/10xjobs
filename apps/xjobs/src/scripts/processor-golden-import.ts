/**
 * Ports career-hub's golden extractions to `modules/processor/golden/cases/`:
 *
 *   pnpm --filter @xjobs/xjobs processor:golden-import -- <career-hub path>
 *
 * Reads `<path>/src/extract/golden/*.json`. Owner verdicts and notes, role
 * fit, contact details and the Greenhouse snapshot are dropped, and emails
 * and phone numbers are redacted (see `golden/import.ts`). Existing `drafted`
 * values in `cases/` are kept.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GOLDEN_CASES_DIR,
  type GoldenCase,
} from 'src/modules/processor/golden/golden';
import { translateCase } from 'src/modules/processor/golden/import';
import { SEED } from 'src/modules/processor/vocab/seed-data';

function main(): void {
  const root = process.argv.slice(2).find((a) => a !== '--');
  if (!root)
    throw new Error('usage: processor:golden-import -- <career-hub path>');
  const dir = join(resolve(root), 'src/extract/golden');
  mkdirSync(GOLDEN_CASES_DIR, { recursive: true });
  let written = 0;
  const skipped: string[] = [];
  const unmapped: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<
      string,
      unknown
    >;
    const result = translateCase(raw, SEED);
    if ('skipped' in result) {
      skipped.push(`${String(raw.id)}: ${result.skipped}`);
      continue;
    }
    const out = join(GOLDEN_CASES_DIR, `${result.case.id}.json`);
    if (existsSync(out))
      result.case.drafted =
        (JSON.parse(readFileSync(out, 'utf8')) as GoldenCase).drafted ?? {};
    writeFileSync(out, `${JSON.stringify(result.case, null, 2)}\n`);
    written++;
    for (const u of result.unmapped) unmapped.push(`${result.case.id}: ${u}`);
  }
  console.log(`wrote ${written} cases to ${GOLDEN_CASES_DIR}`);
  console.log(
    `skipped ${skipped.length}:\n${skipped.map((s) => `  ${s}`).join('\n')}`,
  );
  if (unmapped.length)
    console.log(`unmapped:\n${unmapped.map((s) => `  ${s}`).join('\n')}`);
}

main();
