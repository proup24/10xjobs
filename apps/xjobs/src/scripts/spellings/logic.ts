/**
 * Pure decisions of `db:spellings` (`../spellings.ts`): which spellings of a
 * technology jobs really use, which role words a title is missing, and what
 * the optional paid totals check would reserve.
 */
import {
  roleWords,
  POSITION_ROLE_FAMILY,
} from 'src/modules/queries/builders/role-words';
import {
  ENGINEERING_TITLE,
  quoteTerm,
  runCapUsd,
} from '../linkedin-region-test/logic';

/** Hard cap on what one `--check-totals` invocation may reserve. */
export const CHECK_TOTALS_CAP_USD = 0.1;
/** Rows per totals run; only LinkedIn's reported total is read. */
export const CHECK_TOTALS_ROWS = 3;

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive match of `spelling` not inside a longer word. */
function mentions(text: string, spelling: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escape(spelling)}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(text);
}

/**
 * Candidate forms of a technology: its searched spellings, its tag aliases and
 * their case and punctuation variants (`node.js` gives `nodejs` and `node js`).
 * Lowercase, deduped and sorted.
 */
export function candidateForms(
  spellings: readonly string[],
  aliases: readonly string[],
): string[] {
  const forms = new Set<string>();
  for (const raw of [...spellings, ...aliases]) {
    const form = raw.trim().toLowerCase();
    if (!form) continue;
    forms.add(form);
    if (/[._\- ]/.test(form)) {
      forms.add(form.replace(/[._\- ]+/g, ''));
      forms.add(form.replace(/[._\- ]+/g, ' '));
    }
  }
  return [...forms].sort();
}

/**
 * The share of `texts` that mention `technology` in each candidate form.
 * Without candidates the technology's own code is the only form.
 */
export function spellingShares(
  texts: readonly string[],
  technology: string,
  candidates: readonly string[],
): { spelling: string; share: number }[] {
  const forms = candidates.length ? candidates : [technology];
  return forms.map((spelling) => ({
    spelling,
    share: texts.length
      ? texts.filter((text) => mentions(text, spelling)).length / texts.length
      : 0,
  }));
}

/** Spellings not yet searched that jobs use in at least `threshold` of their texts, most used first. */
export function suggestSpellings(
  shares: readonly { spelling: string; share: number }[],
  known: readonly string[],
  threshold = 0.1,
): string[] {
  const knownSet = new Set(known.map((k) => k.toLowerCase()));
  return shares
    .filter(
      (s) => s.share >= threshold && !knownSet.has(s.spelling.toLowerCase()),
    )
    .sort((a, b) => b.share - a.share)
    .map((s) => s.spelling);
}

/** Engineering-titled jobs with none of the role words their languages search for, each title once. */
export function roleWordGaps(
  jobs: readonly { title: string; languages: string[]; position: string }[],
): { title: string }[] {
  const gaps = new Map<string, { title: string }>();
  for (const job of jobs) {
    if (!ENGINEERING_TITLE.test(job.title)) continue;
    if (!Object.hasOwn(POSITION_ROLE_FAMILY, job.position)) continue;
    const title = job.title.toLowerCase();
    const words = roleWords(job.position, job.languages);
    if (words.some((word) => title.includes(word))) continue;
    gaps.set(job.title, { title: job.title });
  }
  return [...gaps.values()];
}

/** Spellings that are the only match in no job: they never earn their place. */
export function unusedSpellings(
  jobs: readonly { text: string }[],
  spellings: readonly string[],
): string[] {
  const earning = new Set<string>();
  for (const job of jobs) {
    const matched = spellings.filter((s) => mentions(job.text, s));
    if (matched.length === 1) earning.add(matched[0]);
  }
  return spellings.filter((s) => !earning.has(s));
}

export interface TotalsRun {
  spelling: string;
  keyword: string;
  rows: number;
  capUsd: number;
}

/** The paid runs `--check-totals` would make, one per spelling, and whether their reserved caps fit. */
export function checkTotalsPlan(spellings: readonly string[]): {
  runs: TotalsRun[];
  reservedUsd: number;
  capUsd: number;
  fits: boolean;
} {
  const runs = spellings.map((spelling) => ({
    spelling,
    keyword: quoteTerm(spelling),
    rows: CHECK_TOTALS_ROWS,
    capUsd: runCapUsd(CHECK_TOTALS_ROWS),
  }));
  const reservedUsd = runs.reduce((sum, run) => sum + run.capUsd, 0);
  return {
    runs,
    reservedUsd,
    capUsd: CHECK_TOTALS_CAP_USD,
    fits: reservedUsd <= CHECK_TOTALS_CAP_USD + 1e-9,
  };
}
