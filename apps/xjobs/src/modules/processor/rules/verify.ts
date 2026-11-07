import { thresholdFor } from '../config/thresholds';
import type { ClosedQuestionKey, DecisionAnswer } from '../models/types';
import type { ListOptions } from '../schema';
import type { ExtractionDocument } from '../schema/extraction';
import type { Verdict } from '../schema/fact';

/** A field Jev can verify; the same keys as the closed questions. */
export type VerifiedField = ClosedQuestionKey;

export interface FieldVerdict {
  key: ClosedQuestionKey;
  verdict: Verdict;
  score: number | null;
  jevPick: string | null;
  generatorValue: string;
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

const toPick = (v: string | boolean | null): string | null =>
  v === null ? null : typeof v === 'boolean' ? yesNo(v) : v;

/**
 * Compares Jev's answers with the generator's (spec §3):
 * same pick at or above the threshold confirms, a different pick at or above
 * it rejects, anything below it, a missing answer or an unknown model is unconfirmed.
 * A confirmed `unstated` stays unstated (the finalizer must not refill it; Task 6).
 */
export function judge(
  generator: Record<ClosedQuestionKey, string>,
  answers: DecisionAnswer[],
  decisionModel: string,
): FieldVerdict[] {
  const byKey = new Map(answers.map((a) => [a.key, a]));
  return (Object.keys(generator) as ClosedQuestionKey[]).map((key) => {
    const generatorValue = generator[key];
    const answer = byKey.get(key);
    const pick = answer ? toPick(answer.value) : null;
    if (!answer || pick === null)
      return {
        key,
        verdict: 'unconfirmed',
        score: null,
        jevPick: null,
        generatorValue,
      };
    const threshold = thresholdFor(decisionModel, key);
    let verdict: Verdict = 'unconfirmed';
    if (threshold !== null && answer.score >= threshold)
      verdict = pick === generatorValue ? 'confirmed' : 'rejected';
    return { key, verdict, score: answer.score, jevPick: pick, generatorValue };
  });
}
