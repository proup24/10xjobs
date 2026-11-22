/**
 * What a drop rule sees, all of it from the original post: its cleaned text,
 * its author's headline, and whether it carries LinkedIn's open-to-work card.
 */
export type RuleInput = {
  text: string;
  headline: string | null;
  openToWorkCard: boolean;
};

/** A rule that finds posts not worth preparing; `match` returns the span or null. */
export type DropRule = {
  name: string;
  match(input: RuleInput): string | null;
};

/** How far into the text a post says it is a job seeker's. */
const OPENING = 200;
/** "open to work", "Open-to-work", "OPENTOWORK" (a cleaned #OpenToWork). */
const OPEN_TO_WORK = /\bopen[\s_-]*to[\s_-]*work\b/iu;
const HIRING = /\bhiring\b/iu;

/** Folds styled letters (𝐎𝐏𝐄𝐍, ｏｐｅｎ) to plain ones before matching. */
const plain = (s: string) => s.normalize('NFKC');

/**
 * The author is looking for work. Three signals, each with no hiring post
 * against it in the labelled sample: the open-to-work card, "open to work" in
 * the text's opening, and "open to work" in the headline. Never "#OpenToWork"
 * anywhere in the text: hiring posts carry it among their hashtags. An opening
 * that also says "hiring" is left to Extract.
 */
const openToWork: DropRule = {
  name: 'open-to-work',
  match({ text, headline, openToWorkCard }) {
    if (openToWorkCard) return 'open-to-work card';
    const opening = plain(text).slice(0, OPENING);
    if (!HIRING.test(opening)) {
      const m = OPEN_TO_WORK.exec(opening);
      if (m) return m[0];
    }
    return headline ? (OPEN_TO_WORK.exec(plain(headline))?.[0] ?? null) : null;
  },
};

/**
 * A bench-sales agency listing its own consultants: a line that is only the
 * heading "Available consultants:" or "Available IT consultants:". Never the
 * bare words: "hotlist", "benchsales" and "availableconsultants" are hashtags
 * on real requirement posts, and "share your available consultants" asks for
 * candidates for a role.
 */
const benchSalesHotlist: DropRule = {
  name: 'bench-sales-hotlist',
  match({ text }) {
    return (
      /^available (?:it )?consultants\s*:$/imu.exec(plain(text))?.[0] ?? null
    );
  },
};

/**
 * The rules that ship, each from the labelled sample (`sample/sample.json`,
 * gated by `sample.spec.ts`: no rule may drop a post labelled hiring or
 * unsure). Left out on purpose:
 * - course or bootcamp ads: none in the sample, and "training" is in hiring posts;
 * - job digests: one example only, and WhatsApp-group or "daily job updates"
 *   plugs ride on hiring posts that each relay a real role;
 * - "this is not a hiring post": two examples, and it also opens posts that
 *   go on to refer a real opening.
 */
export const DROP_RULES: readonly DropRule[] = [openToWork, benchSalesHotlist];

/** The first rule that matches, with its match trimmed to 80 characters. */
export function firstDrop(
  input: RuleInput,
): { rule: string; match: string } | null {
  for (const rule of DROP_RULES) {
    const match = rule.match(input);
    if (match !== null) return { rule: rule.name, match: match.slice(0, 80) };
  }
  return null;
}
