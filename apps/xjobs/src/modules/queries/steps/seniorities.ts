import { BadRequestException } from '@nestjs/common';
import { Seniority } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';

export const SENIORITIES_REQUIRED =
  'seniorities must list at least one seniority';

/** The set deduped, in `Seniority` enum order, so equal sets read the same. */
export function normalizeSeniorities(seniorities: readonly string[]): string[] {
  const wanted = new Set(seniorities);
  return Object.values(Seniority).filter((level) => wanted.has(level));
}

/** Rejects a profile open to no seniority: it would search nothing. */
export function assertHasSeniorities(profile: QuerySearchProfileInput): void {
  if (profile.seniorities.length === 0)
    throw new BadRequestException(SENIORITIES_REQUIRED);
}
