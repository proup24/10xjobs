import { normalizeSeniorities } from './seniorities';
import type { LocationsByArrangement, QuerySearchProfileInput } from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';

/** A location as stored on the profile: trimmed, inner whitespace collapsed, case kept. */
export function displayLocation(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** One spelling per location: builders, hashes, segments and geoIds key on it. */
export function locationKey(text: string): string {
  return displayLocation(text).toLowerCase();
}

/** Display forms, deduped by key within each list; the first spelling wins. */
export function normalizeLocations(
  locations: LocationsByArrangement,
): LocationsByArrangement {
  const normalized = {} as LocationsByArrangement;
  for (const arrangement of LOCATION_ARRANGEMENTS) {
    const seen = new Map<string, string>();
    for (const text of locations[arrangement]) {
      const display = displayLocation(text);
      const key = display.toLowerCase();
      if (!seen.has(key)) seen.set(key, display);
    }
    normalized[arrangement] = [...seen.values()];
  }
  return normalized;
}

/** Formatting differences must not create duplicate permanent builders. */
export function normalizeProfile(
  input: QuerySearchProfileInput,
): QuerySearchProfileInput {
  return {
    ...input,
    locations: normalizeLocations(input.locations),
    seniorities: normalizeSeniorities(input.seniorities),
  };
}
