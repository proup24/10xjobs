import { Logger } from '@nestjs/common';
import {
  EXPERIENCE_LEVEL_SENIORITY,
  LINKEDIN_CONTRACT_TYPES,
} from '../config/evidence';
import type { ClosedQuestionKey, Evidence } from '../models/types';

const logger = new Logger('ProcessorEvidence');
const warned = new Set<string>();

function warnOnce(kind: string, linkedinValue: string): void {
  const id = `${kind}:${linkedinValue}`;
  if (warned.has(id)) return;
  warned.add(id);
  logger.warn(`Unmapped LinkedIn ${kind} value: "${linkedinValue}"`);
}

/** The codes LinkedIn's value allows for this key, or null when there is no comparison. */
export function allowedCodes(
  key: ClosedQuestionKey,
  evidence: Evidence,
): string[] | null {
  if (key === 'seniority' && evidence.experienceLevel !== null) {
    const allowed = EXPERIENCE_LEVEL_SENIORITY[evidence.experienceLevel];
    if (!allowed) warnOnce('experienceLevel', evidence.experienceLevel);
    return allowed ?? null;
  }
  if (key === 'contractType' && evidence.contractType !== null) {
    const allowed = LINKEDIN_CONTRACT_TYPES[evidence.contractType];
    if (!allowed) warnOnce('contractType', evidence.contractType);
    return allowed ?? null;
  }
  return null;
}

/** True when the answer falls outside the codes the ingest evidence allows. */
export function contradictsEvidence(
  key: ClosedQuestionKey,
  value: unknown,
  evidence: Evidence,
): boolean {
  if (typeof value !== 'string' || value === 'unstated') return false;
  const allowed = allowedCodes(key, evidence);
  return allowed !== null && !allowed.includes(value);
}
