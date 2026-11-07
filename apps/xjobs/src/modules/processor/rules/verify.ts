import { thresholdFor } from '../config/thresholds';
import type { ClosedQuestionKey, DecisionAnswer } from '../models/types';
import type { ListOptions } from '../schema';
import type { ExtractionDocument } from '../schema/extraction';
import type { DecidedBy, Verdict } from '../schema/fact';

/** A field Jev can verify; the same keys as the closed questions. */
export type VerifiedField = ClosedQuestionKey;

export interface FieldVerdict {
  key: ClosedQuestionKey;
  verdict: Verdict;
  score: number | null;
  jevPick: string | null;
  generatorValue: string;
  /** Who filled the judged value: a rejected `ingest` value is dropped, never regenerated. */
  decidedBy: DecidedBy;
  /** The generation round the verdict was given in; a carried verdict keeps it. */
  round: number;
}

/** What a judgment needs besides the answers: the round, and who filled each field. */
export interface JudgeContext {
  round: number;
  /** Missing keys count as `generator`. */
  decidedBy: Partial<Record<ClosedQuestionKey, DecidedBy>>;
}

const yesNo = (v: boolean | null | undefined): string =>
  v === null || v === undefined ? 'unstated' : v ? 'yes' : 'no';

/** Maps the generated document to the option strings Jev answers with. */
export function generatorAnswers(
  doc: ExtractionDocument,
  options: ListOptions,
): Record<ClosedQuestionKey, string> {
  const out: Record<string, string> = {
    arrangement: doc.arrangement.value ?? 'unstated',
    seniority: doc.seniority.value ?? 'unstated',
    roleKind: doc.position.value?.roleKind ?? 'unstated',
    contractType: doc.contractType.value ?? 'unstated',
    engagement: doc.engagement.value ?? 'unstated',
    isSoftwareEngineeringRole: yesNo(doc.isSoftwareEngineeringRole.value),
    sponsorshipOffered: doc.workAuthorization.value?.sponsorship ?? 'unstated',
  };
  const present = new Set((doc.junkFlags.value ?? []).map((f) => f.code));
  for (const code of options.junkFlags)
    out[`junk:${code}`] = present.has(code) ? 'yes' : 'no';
  return out as Record<ClosedQuestionKey, string>;
}

/** Who filled each verified field of the generated document. */
export function generatorDecidedBy(
  doc: ExtractionDocument,
  options: ListOptions,
): Record<ClosedQuestionKey, DecidedBy> {
  const out: Record<string, DecidedBy> = {
    arrangement: doc.arrangement.decidedBy,
    seniority: doc.seniority.decidedBy,
    roleKind: doc.position.decidedBy,
    contractType: doc.contractType.decidedBy,
    engagement: doc.engagement.decidedBy,
    isSoftwareEngineeringRole: doc.isSoftwareEngineeringRole.decidedBy,
    sponsorshipOffered: doc.workAuthorization.decidedBy,
  };
  for (const code of options.junkFlags)
    out[`junk:${code}`] = doc.junkFlags.decidedBy;
  return out as Record<ClosedQuestionKey, DecidedBy>;
}

const toPick = (v: string | boolean | null): string | null =>
  v === null ? null : typeof v === 'boolean' ? yesNo(v) : v;

/**
 * Jev's pick as it is compared with the generator's: on a junk flag,
 * `unstated` (no sign of the flag) counts as `no`, since the generator only
 * answers yes or no there.
 */
export function comparablePick(key: string, pick: string): string {
  return key.startsWith('junk:') && pick === 'unstated' ? 'no' : pick;
}

/**
 * Compares Jev's answers with the generator's (spec §3):
 * same pick at or above the threshold confirms, a different pick at or above
 * it rejects, anything below it, a missing answer or an unknown model is unconfirmed.
 * On a junk flag Jev's `unstated` compares as `no` (`comparablePick`); `jevPick`
 * keeps Jev's own answer.
 * A confirmed `unstated` stays unstated (the finalizer must not refill it; Task 6).
 */
export function judge(
  generator: Record<ClosedQuestionKey, string>,
  answers: DecisionAnswer[],
  decisionModel: string,
  context: JudgeContext,
): FieldVerdict[] {
  const byKey = new Map(answers.map((a) => [a.key, a]));
  return (Object.keys(generator) as ClosedQuestionKey[]).map((key) => {
    const generatorValue = generator[key];
    const facts = {
      generatorValue,
      decidedBy: context.decidedBy[key] ?? 'generator',
      round: context.round,
    };
    const answer = byKey.get(key);
    const pick = answer ? toPick(answer.value) : null;
    if (!answer || pick === null)
      return {
        key,
        verdict: 'unconfirmed',
        score: null,
        jevPick: null,
        ...facts,
      };
    const threshold = thresholdFor(decisionModel, key);
    let verdict: Verdict = 'unconfirmed';
    if (threshold !== null && answer.score >= threshold)
      verdict =
        comparablePick(key, pick) === generatorValue ? 'confirmed' : 'rejected';
    return { key, verdict, score: answer.score, jevPick: pick, ...facts };
  });
}
