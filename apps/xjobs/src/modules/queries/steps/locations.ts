import { BadRequestException } from '@nestjs/common';
import type { LocationsByArrangement, QuerySearchProfileInput } from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';

export const LOCATIONS_REQUIRED =
  'locations must list at least one place in remote, hybrid or onsite';

/** True when at least one arrangement lists a location. */
export function hasLocation(locations: LocationsByArrangement): boolean {
  return LOCATION_ARRANGEMENTS.some(
    (arrangement) => (locations[arrangement]?.length ?? 0) > 0,
  );
}

/** Rejects a profile that would search nowhere. */
export function assertHasLocations(profile: QuerySearchProfileInput): void {
  if (!hasLocation(profile.locations))
    throw new BadRequestException(LOCATIONS_REQUIRED);
}
