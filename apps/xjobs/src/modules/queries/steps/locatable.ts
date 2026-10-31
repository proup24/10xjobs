import { BadRequestException } from '@nestjs/common';
import { Arrangement } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';

export const CITY_REQUIRED =
  'city is required when arrangements include onsite or hybrid';

/** Onsite and hybrid searches are bound to the user's city. */
export const PLACE_BOUND: readonly Arrangement[] = [
  Arrangement.onsite,
  Arrangement.hybrid,
];

/** False when an onsite or hybrid search has no city to search in. */
export function isLocatable(
  arrangements: readonly Arrangement[],
  city: string | null | undefined,
): boolean {
  const placeBound = arrangements.some((arrangement) =>
    PLACE_BOUND.includes(arrangement),
  );
  return !placeBound || !!city?.trim();
}

/** Rejects a profile whose onsite or hybrid searches would have no city. */
export function assertLocatable(profile: QuerySearchProfileInput): void {
  if (!isLocatable(profile.arrangements, profile.city))
    throw new BadRequestException(CITY_REQUIRED);
}
