/**
 * The golden review sheet (slice 03 Part 5): which labels a human must read
 * after an eval run, and which drafts the run confirms. Pure: the
 * `processor:golden-review` script reads and writes the files.
 */
import type { GoldenCase, LabelKey } from './golden';
import type { DraftCheck, ListingReportFile } from './score';

export type ReviewReason =
  /** The eval's value differs from a label that counts (`expected` or a reviewed draft). */
  | 'differs'
  /** A drafted key a human must always read (`requirements`), or one the eval gave no answer for. */
  | 'unreviewed'
  /** A new-label draft (`arrangement`, `contractType`, `isSoftwareEngineeringRole`) the eval disagrees with. */
  | 'disagrees';

export interface ReviewItem {
  caseId: string;
  title: string;
  field: string;
  reason: ReviewReason;
  label: unknown;
  /** The processor's value; undefined when the case has no eval answer. */
  got: unknown;
  quote: string;
}

type ReportPart = Pick<ListingReportFile, 'misses' | 'scores'>;

const byCase = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true });

const requirementKey = (r: unknown): string | null => {
  if (!r || typeof r !== 'object') return null;
  const { text, code, kind } = r as Record<string, unknown>;
  if (typeof text !== 'string') return null;
  return JSON.stringify([
    text.trim().toLowerCase(),
    code ?? null,
    kind ?? null,
  ]);
};

/**
 * A `requirements` draft agrees when both sides hold the same requirements on
 * text (trimmed, any case), code and kind. Order, domain, years and group are
 * not compared: the labels do not carry them.
 */
function requirementsAgree(check: DraftCheck | undefined): boolean {
  if (!check || !Array.isArray(check.label) || !Array.isArray(check.got))
    return false;
  const keys = (list: unknown[]) => list.map(requirementKey).sort();
  const want = keys(check.label);
  const got = keys(check.got);
  return (
    !want.includes(null) &&
    !got.includes(null) &&
    want.length === got.length &&
    want.every((k, i) => k === got[i])
  );
}

const draftAgrees = (key: string, check: DraftCheck | undefined): boolean =>
  key === 'requirements' ? requirementsAgree(check) : check?.agrees === true;

/** Every item a human must read, ordered by case, then field. */
export function reviewItems(
  report: ReportPart,
  cases: readonly GoldenCase[],
): ReviewItem[] {
  const title = new Map(cases.map((c) => [c.id, c.input.title]));
  const items: ReviewItem[] = report.misses.map((m) => ({
    caseId: m.caseId,
    title: m.title,
    field: m.fact,
    reason: 'differs',
    label: m.want,
    got: m.got,
    quote: m.quote,
  }));
  const scored = new Map(report.scores.map((s) => [s.caseId, s]));
  for (const c of cases) {
    const score = scored.get(c.id);
    for (const [field, d] of Object.entries(c.drafted)) {
      if (!d || d.reviewed) continue;
      const check = score?.drafts[field as keyof typeof c.drafted];
      if (draftAgrees(field, check)) continue;
      items.push({
        caseId: c.id,
        title: title.get(c.id) ?? '',
        field,
        reason: check?.agrees === false ? 'disagrees' : 'unreviewed',
        label: check ? check.label : d.value,
        got: check?.got,
        quote: check?.quote ?? '',
      });
    }
  }
  return items.sort(
    (a, b) => byCase(a.caseId, b.caseId) || a.field.localeCompare(b.field),
  );
}

/** Drafts the eval agrees with: they get `reviewed: true` (the posts-eval precedent). */
export function agreements(
  report: ReportPart,
): { caseId: string; key: LabelKey }[] {
  return report.scores.flatMap((s) =>
    Object.entries(s.drafts).flatMap(([key, d]) =>
      draftAgrees(key, d) ? [{ caseId: s.caseId, key: key as LabelKey }] : [],
    ),
  );
}

/** The cases `confirmed` changes, with those drafts marked reviewed. */
export function confirm(
  cases: readonly GoldenCase[],
  confirmed: readonly { caseId: string; key: LabelKey }[],
): GoldenCase[] {
  const changed: GoldenCase[] = [];
  for (const c of cases) {
    const keys = confirmed.filter((a) => a.caseId === c.id).map((a) => a.key);
    if (keys.length === 0) continue;
    const drafted = { ...c.drafted };
    for (const key of keys) {
      const d = drafted[key];
      if (d) drafted[key] = { ...d, reviewed: true };
    }
    changed.push({ ...c, drafted });
  }
  return changed;
}

const show = (v: unknown): string => {
  if (v === undefined) return '(no eval answer)';
  if (Array.isArray(v) && v.every((r) => r && typeof r === 'object'))
    return v.length === 0
      ? '[]'
      : v.map((r) => `\n    - ${JSON.stringify(r)}`).join('');
  return typeof v === 'string' ? v : JSON.stringify(v);
};

/** The sheet: items numbered from 1, in batches of `batchSize`. */
export function renderReview(items: readonly ReviewItem[], batchSize = 25) {
  const lines = [`# Golden review: ${items.length} items`, ''];
  items.forEach((item, i) => {
    if (i % batchSize === 0)
      lines.push(
        `## Batch ${i / batchSize + 1} (items ${i + 1}–${Math.min(i + batchSize, items.length)})`,
        '',
      );
    lines.push(
      `### ${i + 1}. ${item.caseId}: ${item.title}`,
      '',
      `- field: \`${item.field}\` (${item.reason})`,
      `- label: ${show(item.label)}`,
      `- processor: ${show(item.got)}`,
      `- quote: ${item.quote ? `"${item.quote}"` : '-'}`,
      '',
    );
  });
  return `${lines.join('\n')}\n`;
}
