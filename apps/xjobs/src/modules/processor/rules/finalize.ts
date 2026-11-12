import type { ClosedQuestionKey } from '../models/types';
import type { ExtractionDocument } from '../schema/extraction';
import type { Verdict, Verification } from '../schema/fact';
import type { FieldVerdict } from './verify';

export interface ApplyOptions {
  round: number;
  final: boolean;
  regenerationInvalid: boolean;
}

const RANK: Record<Verdict, number> = {
  confirmed: 0,
  unconfirmed: 1,
  rejected: 2,
};

type Envelope = {
  value: unknown;
  confidence: 'sure' | 'unsure';
  score: number | null;
  quote: string;
  verification: Verification | null;
};

/**
 * Applies Jev's verdicts to the generated document (spec §4).
 * Confirmed -> sure; unconfirmed -> unsure; rejected on the final round -> dropped
 * A rejection before the final round only records the verdict.
 */
export function applyVerdicts(
  doc: ExtractionDocument,
  verdicts: FieldVerdict[],
  opts: ApplyOptions,
): ExtractionDocument {
  const out = structuredClone(doc);
  const dropped = out.verification.dropped;
  const drop = (v: FieldVerdict, field = v.key as string): void => {
    if (!dropped.some((d) => d.field === field))
      dropped.push({
        field,
        generatorValue: v.generatorValue,
        jevPick: v.jevPick,
      });
  };
  /** `rounds` is the round the verdict was given in: a carried verdict keeps its own. */
  const record = (
    fact: Envelope,
    v: Pick<FieldVerdict, 'verdict' | 'score' | 'jevPick' | 'round'>,
  ): void => {
    fact.verification = {
      verdict: v.verdict,
      score: v.score,
      jevPick: v.jevPick,
      rounds: v.round,
    };
  };
  const settle = (fact: Envelope, v: FieldVerdict): boolean => {
    record(fact, v);
    if (v.verdict === 'confirmed') {
      fact.confidence = 'sure';
      fact.score = v.score;
    } else if (v.verdict === 'unconfirmed') {
      fact.confidence = 'unsure';
      fact.score = v.score;
    } else if (opts.final) {
      fact.confidence = 'unsure';
      fact.score = null;
      return true;
    }
    return false;
  };

  const junk: FieldVerdict[] = [];
  for (const v of verdicts) {
    if (v.key.startsWith('junk:')) {
      junk.push(v);
      continue;
    }
    switch (v.key) {
      case 'arrangement':
      case 'seniority':
      case 'contractType':
      case 'engagement': {
        const fact = out[v.key];
        if (settle(fact, v)) {
          fact.value = 'unstated';
          fact.quote = '';
          drop(v);
          if (v.key === 'arrangement')
            for (const o of out.openings) o.confidence = 'unsure';
        }
        break;
      }
      case 'roleKind': {
        const fact = out.position;
        if (settle(fact, v)) {
          if (fact.value) fact.value.roleKind = 'unstated';
          fact.quote = '';
          drop(v);
        }
        break;
      }
      case 'isSoftwareEngineeringRole': {
        const fact = out.isSoftwareEngineeringRole;
        if (settle(fact, v)) {
          fact.value = null;
          fact.quote = '';
          drop(v);
        }
        break;
      }
      case 'sponsorshipOffered': {
        const fact = out.workAuthorization;
        if (settle(fact, v)) {
          if (fact.value) fact.value.sponsorship = 'unstated';
          fact.quote = '';
          drop(v);
        }
        break;
      }
    }
  }

  if (junk.length > 0) {
    const fact = out.junkFlags;
    const worst = junk.reduce((a, b) =>
      RANK[b.verdict] > RANK[a.verdict] ? b : a,
    );
    const scores = junk
      .map((j) => j.score)
      .filter((s): s is number => s !== null);
    record(fact, {
      verdict: worst.verdict,
      score: scores.length ? Math.min(...scores) : null,
      jevPick: worst.jevPick,
      // The envelope is settled when its last flag was judged.
      round: Math.max(...junk.map((j) => j.round)),
    });
    fact.confidence = worst.verdict === 'confirmed' ? 'sure' : 'unsure';
    fact.score = fact.verification?.score ?? null;
    if (opts.final) {
      for (const v of junk) {
        if (v.verdict !== 'rejected') continue;
        const code = v.key.slice('junk:'.length);
        const flags = fact.value ?? [];
        if (flags.some((f) => f.code === code)) {
          fact.value = flags.filter((f) => f.code !== code);
          drop(v);
        } else if (
          // Jev's `unstated` confirms an omitted flag (verify.ts), so only a
          // `yes` is a flag the generator missed.
          v.jevPick === 'yes' &&
          !out.verification.missedJunkFlags.includes(code)
        ) {
          out.verification.missedJunkFlags.push(code);
        }
      }
    }
  }

  out.verification.rounds = opts.round;
  out.verification.regenerationInvalid = opts.regenerationInvalid;
  return out;
}

/**
 * Keeps confirmed verdicts whose generator value did not change;
 * every other key is asked again.
 */
export function carryVerdicts(
  previous: FieldVerdict[],
  prevGen: Record<ClosedQuestionKey, string>,
  nextGen: Record<ClosedQuestionKey, string>,
): { kept: FieldVerdict[]; toAsk: Set<ClosedQuestionKey> } {
  const kept: FieldVerdict[] = [];
  const toAsk = new Set<ClosedQuestionKey>();
  const prevByKey = new Map(previous.map((p) => [p.key, p]));
  for (const key of Object.keys(nextGen) as ClosedQuestionKey[]) {
    const p = prevByKey.get(key);
    if (p && p.verdict === 'confirmed' && prevGen[key] === nextGen[key])
      kept.push(p);
    else toAsk.add(key);
  }
  return { kept, toAsk };
}
