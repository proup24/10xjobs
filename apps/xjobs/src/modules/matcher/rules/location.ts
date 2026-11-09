import type { Opening } from 'src/modules/processor/schema';
import {
  LOCATION_ARRANGEMENTS,
  type LocationArrangement,
} from 'src/modules/queries';
import { overlaps, type Overlap, type PlaceIndex } from './places';
import {
  bestOutcome,
  type Check,
  type CheckOutcome,
  type MatchProfile,
} from './types';

const ALL_ARRANGEMENTS: readonly LocationArrangement[] = LOCATION_ARRANGEMENTS;

function isArrangement(value: string): value is LocationArrangement {
  return (ALL_ARRANGEMENTS as readonly string[]).includes(value);
}

function checkArrangement(
  opening: Opening,
  arrangement: LocationArrangement,
  profile: MatchProfile,
  idx: PlaceIndex,
): CheckOutcome {
  let outcome: CheckOutcome;
  if (opening.places.length === 0) {
    outcome = 'unknown';
  } else {
    const found = new Set<Overlap>();
    for (const jobPlace of opening.places)
      for (const profilePlace of profile.locations[arrangement])
        found.add(overlaps(jobPlace, profilePlace, idx));
    if (found.has('yes')) outcome = 'pass';
    else if (found.has('maybe')) outcome = 'unknown';
    else outcome = opening.placeStrictness === 'mention' ? 'unknown' : 'fail';
  }
  if (arrangement === 'remote' && opening.timezones.length > 0) {
    const fits = opening.timezones.some(
      (tz) =>
        tz.fromUtc <= profile.timezoneMax / 60 &&
        tz.toUtc >= profile.timezoneMin / 60,
    );
    if (!fits) return 'fail';
  }
  return outcome;
}

function checkOpening(
  opening: Opening,
  profile: MatchProfile,
  idx: PlaceIndex,
) {
  const stated = opening.arrangements.filter(isArrangement);
  const onlyUnstated = !opening.arrangements.some((a) => a !== 'unstated');
  const expanded = opening.arrangements.includes('unstated')
    ? [...new Set([...stated, ...ALL_ARRANGEMENTS])]
    : stated;
  const kept = expanded.filter((a) => profile.locations[a].length > 0);
  if (kept.length === 0) {
    return { outcome: 'fail' as CheckOutcome, deciding: null, kept };
  }
  const results = kept.map((a) => ({
    arrangement: a,
    outcome: checkArrangement(opening, a, profile, idx),
  }));
  const best = bestOutcome(results.map((r) => r.outcome));
  const outcome = onlyUnstated && best === 'pass' ? 'unknown' : best;
  const deciding = results.find((r) => r.outcome === best);
  return { outcome, deciding: deciding?.arrangement ?? null, kept };
}

/** Whether any opening's arrangement, place and time zone fit where the profile works. */
export function checkLocation(
  openings: Opening[],
  profile: MatchProfile,
  idx: PlaceIndex,
): Check {
  const per = openings.map((opening) => ({
    opening,
    ...checkOpening(opening, profile, idx),
  }));
  const outcome = bestOutcome(per.map((p) => p.outcome));
  const detail = per.map((p) => ({
    arrangements: p.opening.arrangements,
    places: p.opening.places,
    placeStrictness: p.opening.placeStrictness,
    timezones: p.opening.timezones,
    decidedBy: p.deciding,
    outcome: p.outcome,
  }));
  const jobValue = openings.map((o) => ({
    arrangements: o.arrangements,
    places: o.places,
  }));
  const wanted = Object.fromEntries(
    ALL_ARRANGEMENTS.map((a) => [a, profile.locations[a]]),
  );

  const arrangementsText = (list: string[]) => list.join('/');
  const jobText = openings
    .map(
      (o) =>
        `${arrangementsText(o.arrangements)}${o.places.length ? ` in ${o.places.map(placeText).join(', ')}` : ''}`,
    )
    .join('; ');
  const profileText = ALL_ARRANGEMENTS.filter(
    (a) => profile.locations[a].length > 0,
  ).join(', ');
  const verb =
    outcome === 'pass'
      ? 'fits'
      : outcome === 'unknown'
        ? 'may fit'
        : 'does not fit';
  const reason = `job location (${jobText || 'not stated'}) ${verb} your wanted arrangements (${profileText || 'none'})`;
  return {
    rule: 'location',
    outcome,
    jobValue,
    profileValue: wanted,
    reason,
    detail,
  };
}

function placeText(place: Opening['places'][number]): string {
  switch (place.kind) {
    case 'worldwide':
      return 'worldwide';
    case 'city':
      return place.name;
    default:
      return place.code;
  }
}
