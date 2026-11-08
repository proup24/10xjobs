/**
 * One-off: moves the golden cases to the requirements shape of the
 * generate-then-verify spec (section 5a), and whole `yearsRequired` to ranges:
 *
 *   cd apps/xjobs && pnpm exec tsx --conditions=@xjobs/source --tsconfig tsconfig.app.json src/scripts/processor-golden-v2.ts
 *
 * Kept as the record of the conversion. Idempotent: a converted case is left
 * as it is. `domain` and `years` stay null (`drafted.requirements`) until a
 * human labels them. Run Prettier on `golden/cases` after it writes.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  convertGoldenCase,
  GOLDEN_CASES_DIR,
} from 'src/modules/processor/golden/golden';

function main(): void {
  let changed = 0;
  let requirements = 0;
  let groups = 0;
  const files = readdirSync(GOLDEN_CASES_DIR).filter((f) =>
    f.endsWith('.json'),
  );
  for (const file of files) {
    const path = join(GOLDEN_CASES_DIR, file);
    const before: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const converted = convertGoldenCase(structuredClone(before));
    requirements += converted.expected.requirements?.length ?? 0;
    groups += converted.expected.groups?.length ?? 0;
    // Compared as data, so the files' Prettier layout does not count as a change.
    if (JSON.stringify(converted) === JSON.stringify(before)) continue;
    writeFileSync(path, `${JSON.stringify(converted, null, 2)}\n`);
    changed++;
  }
  console.log(
    `${files.length} cases, ${changed} converted; ${requirements} requirements in ${groups} groups`,
  );
}

main();
