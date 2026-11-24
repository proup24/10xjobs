import { roleKeys } from '../../rules/role-key';
import type { Confidence } from '../../schema';
import { VERDICTS, type Verdict } from '../../schema/post-extraction';
import type { AssembledPost } from '../../services/post-assembler.service';
import type { GoldenCase, LabelKey } from '../golden';
import {
  type CallStats,
  type EvalReport,
  type FactScores,
  scoreCase,
  summarize,
} from '../score';
import type { PostGoldenCase, PostGoldenRole } from './golden-posts';

/** The bars slice 05's automatic emails wait for (spec "The golden set and the bar for slice 05"). */
export const POST_BARS = {
  wrongSends: 0,
  contactEmailExact: 1,
  hiringKept: 0.95,
} as const;
export type PostBarName = keyof typeof POST_BARS;

/** What the pipeline gave for a case: the assembled post, or the errors of a generation that never validated. */
export type PostResult = Pick<AssembledPost, 'doc'> | { failed: string[] };

/** One role's contact email, labelled and extracted, paired by role key (`pairRoles`). */
export interface RoleEmail {
  /** The labelled role's key, or the extracted one's when no label pairs with it. */
  roleKey: string;
  want: string | null;
  got: string | null;
}

export interface PostScore {
  /** The case's position in `cases.json` (0-based, as the owner numbers posts). */
  index: number | null;
  rawItemId: string;
  label: Verdict;
  verdictReviewed: boolean;
  /** Every labelled role reviewed, and at least one for a hiring label. */
  rolesReviewed: boolean;
  /** Verdict reviewed by the owner and, for hiring, every role too (absent `reviewedBy` is the owner). */
  ownerReviewed: boolean;
  got: { value: Verdict; confidence: Confidence } | null;
  /** The generation's last errors when it never validated; null otherwise. */
  failed: string[] | null;
  sureHiring: boolean;
  /** Sure hiring with at least one role email: what slice 05 would send to. */
  sendsEmail: boolean;
  /** Every role email extracted, in document order. */
  gotEmails: string[];
  /** Labelled hiring only: every role, paired by role key (`pairRoles`); null otherwise. */
  emails: RoleEmail[] | null;
  /**
   * False on a reviewed hiring case whose extracted role count differs from
   * the labelled one (a send goes to every role); null when no role on
   * either side has an email (nothing to send to).
   */
  emailExact: boolean | null;
  /** Whether the labelled and extracted role counts differ, on a reviewed hiring case. */
  roleCountMiss: boolean;
  roleCount: { want: number; got: number };
  /** Pairs whose labelled and extracted role keys differ: a warning, not a miss. */
  keyMismatches: { want: string; got: string }[];
  /** Listing fact scores of each reviewed labelled role that has an extracted pair. */
  roleFacts: FactScores[];
  generatorCalls: number;
  costUsd: number;
}

const sameEmail = (a: string | null, b: string | null): boolean =>
  (a?.trim().toLowerCase() ?? null) === (b?.trim().toLowerCase() ?? null);

const byKey = <T>(items: T[], keys: string[]): { key: string; item: T }[] =>
  items
    .map((item, i) => ({ key: keys[i], item }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

type Keyed<T> = { key: string; item: T };
/** A labelled and an extracted role, at least one there; `key` is the label's, else the extracted one's. */
type RolePair<W, G> = { key: string; want?: Keyed<W>; got?: Keyed<G> };

/** Share of the two keys' words they have in common (0 to 1). */
const keyOverlap = (a: string, b: string): number => {
  const x = new Set(a.split('-'));
  const y = new Set(b.split('-'));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / new Set([...x, ...y]).size;
};

/**
 * Pairs labelled and extracted roles (both sorted by key): equal keys first,
 * then the closest keys by shared words, then what is left by key order. Pairing
 * by order alone shifts every pair when one key sorts elsewhere ("180-recruitment-
 * consultant" against "recruitment-consultant"). Pairs come out in key order.
 */
function pairRoles<W, G>(want: Keyed<W>[], got: Keyed<G>[]): RolePair<W, G>[] {
  const pairs: RolePair<W, G>[] = [];
  let w = [...want];
  let g = [...got];
  const take = (a: Keyed<W>, b: Keyed<G>): void => {
    pairs.push({ key: a.key, want: a, got: b });
    w = w.filter((x) => x !== a);
    g = g.filter((x) => x !== b);
  };
  for (const a of want) {
    const b = g.find((x) => x.key === a.key);
    if (b) take(a, b);
  }
  for (;;) {
    let best: { a: Keyed<W>; b: Keyed<G>; score: number } | null = null;
    for (const a of w)
      for (const b of g) {
        const score = keyOverlap(a.key, b.key);
        if (score > 0 && (best === null || score > best.score))
          best = { a, b, score };
      }
    if (best === null) break;
    take(best.a, best.b);
  }
  const rest = Math.max(w.length, g.length);
  for (let i = 0; i < rest; i++) {
    const a = w[i];
    const b = g[i];
    pairs.push({ key: (a ?? b).key, want: a, got: b });
  }
  return pairs.sort((a, b) => (a.key < b.key ? -1 : 1));
}

const LABEL_KEYS: readonly LabelKey[] = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
  'engagement',
];

/**
 * A reviewed role as a listing golden case, so `scoreCase` scores its facts.
 * The four drafted facts go in `drafted` as reviewed: the role's review covers them.
 */
function roleCase(id: string, role: PostGoldenRole): GoldenCase {
  const drafted: GoldenCase['drafted'] = {};
  for (const key of LABEL_KEYS)
    if (role.facts[key] !== undefined)
      drafted[key] = { value: role.facts[key], reviewed: true };
  return {
    id,
    input: { title: role.title, description: '' },
    expected: role.facts,
    drafted,
  };
}

/**
 * Scores one post case. Roles are paired by role key (`roleKeys` of the
 * labelled titles, the document's `roleKey`s) with `pairRoles`. A labelled role with no extracted pair counts as an extracted
 * null email, an extracted role with no label as a labelled null email, so a
 * missing labelled email or an extra extracted one is a miss. On a reviewed
 * hiring case, a different role count is an email miss too. A pair whose keys
 * differ is a warning (titles vary), and its facts are still scored. Role
 * facts are scored only on reviewed labelled roles with a pair. A failed generation
 * extracts nothing: not kept, and a miss on any labelled email.
 */
export function scorePost(
  c: PostGoldenCase,
  got: PostResult,
  extra: Partial<CallStats> & { index?: number } = {},
): PostScore {
  const doc = 'doc' in got ? got.doc : null;
  const label = c.verdict.value;
  const extracted = doc?.roles ?? [];
  const sureHiring =
    doc?.verdict.value === 'hiring' && doc.verdict.confidence === 'sure';

  const gotEmails = extracted.flatMap((r) =>
    r.howToApply.email === null ? [] : [r.howToApply.email],
  );

  const wantRoles = byKey(c.roles, roleKeys(c.roles.map((r) => r.title)));
  const gotRoles = byKey(
    extracted,
    extracted.map((r) => r.roleKey),
  );
  const pairs = pairRoles(wantRoles, gotRoles);

  const rolesReviewed =
    c.roles.every((r) => r.reviewed) &&
    (label !== 'hiring' || c.roles.length > 0);
  const roleCountMiss =
    label === 'hiring' && rolesReviewed && c.roles.length !== extracted.length;
  let emails: RoleEmail[] | null = null;
  let emailExact: boolean | null = null;
  if (label === 'hiring') {
    emails = pairs.map(({ key, want, got: g }) => ({
      roleKey: key,
      want: want?.item.contactEmail ?? null,
      got: g?.item.howToApply.email ?? null,
    }));
    emailExact = emails.some((e) => e.want !== null || e.got !== null)
      ? emails.every((e) => sameEmail(e.want, e.got))
      : null;
    if (roleCountMiss) emailExact = false;
  }
  const keyMismatches = pairs.flatMap(({ want, got: g }) =>
    want && g && want.key !== g.key ? [{ want: want.key, got: g.key }] : [],
  );

  const roleFacts = pairs.flatMap(({ want, got: g }) =>
    want?.item.reviewed && g
      ? [
          scoreCase(
            g.item.facts,
            roleCase(`${extra.index ?? c.rawItemId}:${want.key}`, want.item),
          ),
        ]
      : [],
  );

  const byOwner = (x: { reviewed: boolean; reviewedBy?: string }): boolean =>
    x.reviewed && (x.reviewedBy ?? 'owner') === 'owner';

  return {
    index: extra.index ?? null,
    rawItemId: c.rawItemId,
    label,
    verdictReviewed: c.verdict.reviewed,
    rolesReviewed,
    ownerReviewed:
      byOwner(c.verdict) &&
      c.roles.every(byOwner) &&
      (label !== 'hiring' || c.roles.length > 0),
    got: doc
      ? { value: doc.verdict.value, confidence: doc.verdict.confidence }
      : null,
    failed: 'failed' in got ? got.failed : null,
    sureHiring,
    sendsEmail: sureHiring && gotEmails.length > 0,
    gotEmails,
    emails,
    emailExact,
    roleCountMiss,
    roleCount: { want: c.roles.length, got: extracted.length },
    keyMismatches,
    roleFacts,
    generatorCalls: extra.generatorCalls ?? 0,
    costUsd: extra.costUsd ?? 0,
  };
}

export interface PostBar {
  /** wrongSends: a count; the others: a share, null when no case is scored. */
  value: number | null;
  threshold: number;
  /** Cases the bar is computed over. */
  scored: number;
  /** Cases whose unreviewed label the bar uses; any one fails the bar. */
  blockedBy: (number | string)[];
  pass: boolean;
}

/** One reason a case counts against a bar (or did not generate). */
export interface PostFailure {
  index: number | string;
  /** `roleKey` is a warning: titles vary, so another key in a pair is not a miss. */
  bar: PostBarName | 'generation' | 'roleKey' | 'roleFacts';
  reason: string;
}

type Outcome = { sure: number; unsure: number };
/** Per label: what the cases came out as, by confidence, and how many failed. */
export type PostConfusion = Record<
  Verdict,
  Record<Verdict, Outcome> & { failed: number }
>;

export interface PostEvalReport {
  cases: number;
  confusion: PostConfusion;
  /** Unsure verdicts, by the case's label. */
  unsureByLabel: Record<Verdict, number>;
  bars: Record<PostBarName, PostBar>;
  /** Cases whose labels the owner reviewed (see `PostScore.ownerReviewed`). */
  ownerCases: number;
  /** The same three bars over the owner-reviewed cases alone. */
  ownerBars: Record<PostBarName, PostBar>;
  /**
   * The listing fact bars on the reviewed labelled roles, plus the cases
   * blocking them; a fact bar no reviewed role labels passes (it does not apply).
   */
  roleFacts: EvalReport & { blockedBy: (number | string)[] };
  generatorCallsPerPost: number;
  costPerPost: number;
  failures: PostFailure[];
  pass: boolean;
}

const idOf = (s: PostScore): number | string => s.index ?? s.rawItemId;
const show = (email: string | null): string => email ?? 'no email';
const outcome = (s: PostScore): string =>
  s.got ? `${s.got.value} (${s.got.confidence})` : 'nothing (failed)';

/** The three bars over `scores`, with the cases whose unreviewed labels block them. */
function barsOf(
  scores: PostScore[],
  verdictBlocked: (number | string)[],
  roleBlocked: (number | string)[],
): Record<PostBarName, PostBar> {
  const notHiring = scores.filter((s) => s.label !== 'hiring');
  const hiring = scores.filter((s) => s.label === 'hiring');
  const withEmail = hiring.filter((s) => s.emailExact !== null);

  // A not-hiring or junk case that never generated proves nothing about a send.
  const sendBlocked = [
    ...new Set([
      ...verdictBlocked,
      ...notHiring.filter((s) => s.failed).map(idOf),
    ]),
  ];
  const wrongSends = notHiring.filter((s) => s.sendsEmail);
  const kept = hiring.filter((s) => s.sureHiring);
  const exact = withEmail.filter((s) => s.emailExact);

  const share = (n: number, d: number): number | null =>
    d === 0 ? null : n / d;
  const bar = (
    value: number | null,
    threshold: number,
    scored: number,
    blockedBy: (number | string)[],
    holds: (v: number) => boolean,
  ): PostBar => ({
    value,
    threshold,
    scored,
    blockedBy,
    // A share with nothing scored proves nothing, as for the listing bars.
    pass: blockedBy.length === 0 && value !== null && holds(value),
  });
  const bars: Record<PostBarName, PostBar> = {
    wrongSends: bar(
      wrongSends.length,
      POST_BARS.wrongSends,
      notHiring.length,
      sendBlocked,
      (v) => v <= POST_BARS.wrongSends,
    ),
    contactEmailExact: bar(
      share(exact.length, withEmail.length),
      POST_BARS.contactEmailExact,
      withEmail.length,
      roleBlocked,
      (v) => v >= POST_BARS.contactEmailExact,
    ),
    hiringKept: bar(
      share(kept.length, hiring.length),
      POST_BARS.hiringKept,
      hiring.length,
      verdictBlocked,
      (v) => v >= POST_BARS.hiringKept,
    ),
  };
  return bars;
}

/**
 * The post report. Every bar uses every case's verdict label (it decides
 * which cases a bar counts), so one unreviewed verdict fails all of them; the
 * email and role fact bars also use the role labels of the cases labelled
 * hiring, so an unreviewed role, or a hiring case with no roles, fails those.
 * A not-hiring or junk case whose generation failed also blocks wrongSends.
 */
export function summarizePosts(scores: PostScore[]): PostEvalReport {
  const verdictBlocked = scores.filter((s) => !s.verdictReviewed).map(idOf);
  const roleBlocked = [
    ...new Set([
      ...verdictBlocked,
      ...scores
        .filter((s) => s.label === 'hiring' && !s.rolesReviewed)
        .map(idOf),
    ]),
  ];

  const bars = barsOf(scores, verdictBlocked, roleBlocked);
  const owner = scores.filter((s) => s.ownerReviewed);
  const ownerBars = barsOf(owner, [], []);

  const facts = summarize(scores.flatMap((s) => s.roleFacts));
  // A listing fact bar applies only where some reviewed role labels its fact.
  const factBars = {
    openingPlaces:
      facts.bars.openingPlaces || facts.facts.openingPlaces.scored === 0,
    arrangement: facts.bars.arrangement || facts.facts.arrangement.scored === 0,
    mainStack: facts.bars.mainStack || facts.facts.mainStack.scored === 0,
    sureContradicted: facts.bars.sureContradicted,
  };
  const roleFacts = {
    ...facts,
    bars: factBars,
    blockedBy: roleBlocked,
    pass: Object.values(factBars).every(Boolean) && roleBlocked.length === 0,
  };

  const perPost = (pick: (s: PostScore) => number): number =>
    scores.length === 0
      ? 0
      : scores.reduce((n, s) => n + pick(s), 0) / scores.length;

  return {
    cases: scores.length,
    ...confusionOf(scores),
    bars,
    ownerCases: owner.length,
    ownerBars,
    roleFacts,
    generatorCallsPerPost: perPost((s) => s.generatorCalls),
    costPerPost: perPost((s) => s.costUsd),
    failures: scores.flatMap(failuresOf),
    pass: Object.values(bars).every((b) => b.pass) && roleFacts.pass,
  };
}

function confusionOf(
  scores: PostScore[],
): Pick<PostEvalReport, 'confusion' | 'unsureByLabel'> {
  const row = () =>
    ({
      ...Object.fromEntries(VERDICTS.map((v) => [v, { sure: 0, unsure: 0 }])),
      failed: 0,
    }) as PostConfusion[Verdict];
  const confusion = Object.fromEntries(
    VERDICTS.map((v) => [v, row()]),
  ) as PostConfusion;
  const unsureByLabel = Object.fromEntries(
    VERDICTS.map((v) => [v, 0]),
  ) as Record<Verdict, number>;
  for (const s of scores) {
    if (!s.got) {
      confusion[s.label].failed++;
      continue;
    }
    confusion[s.label][s.got.value][s.got.confidence]++;
    if (s.got.confidence === 'unsure') unsureByLabel[s.label]++;
  }
  return { confusion, unsureByLabel };
}

function failuresOf(s: PostScore): PostFailure[] {
  const index = idOf(s);
  const out: PostFailure[] = [];
  if (s.failed)
    out.push({
      index,
      bar: 'generation',
      reason: `failed: ${s.failed.join('; ')}`,
    });
  if (s.label !== 'hiring' && s.sendsEmail)
    out.push({
      index,
      bar: 'wrongSends',
      reason: `labelled ${s.label}, came out ${outcome(s)} with ${s.gotEmails.join(', ')}`,
    });
  if (s.label === 'hiring' && !s.sureHiring)
    out.push({
      index,
      bar: 'hiringKept',
      reason: `labelled hiring, came out ${outcome(s)}`,
    });
  for (const e of s.emails ?? [])
    if (!sameEmail(e.want, e.got))
      out.push({
        index,
        bar: 'contactEmailExact',
        reason: `role ${e.roleKey}: want ${show(e.want)}, got ${show(e.got)}`,
      });
  if (s.roleCountMiss)
    out.push({
      index,
      bar: 'contactEmailExact',
      reason: `${s.roleCount.want} roles labelled, ${s.roleCount.got} extracted`,
    });
  for (const k of s.keyMismatches)
    out.push({
      index,
      bar: 'roleKey',
      reason: `warning: labelled role ${k.want} paired with extracted ${k.got}`,
    });
  for (const r of s.roleFacts)
    for (const [fact, f] of Object.entries(r.facts))
      if (f && f.correct < f.total)
        out.push({
          index,
          bar: 'roleFacts',
          reason: `${r.caseId} ${fact}: want ${JSON.stringify(f.want)}, got ${JSON.stringify(f.got)}${f.confidence ? ` [${f.confidence}]` : ''}`,
        });
  return out;
}
