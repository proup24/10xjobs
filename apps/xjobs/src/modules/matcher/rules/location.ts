import type { FactOpening as Opening } from 'src/modules/facts/schema/facts';
import {
  LOCATION_ARRANGEMENTS,
  type LocationArrangement,
} from 'src/modules/queries';
import { overlaps, type Overlap, type PlaceIndex } from './places';
import {
  bestOutcome,
  restsOn,
  type Check,
  type CheckOutcome,
  type MatchProfile,
} from './types';

const ALL_ARRANGEMENTS: readonly LocationArrangement[] = LOCATION_ARRANGEMENTS;

function isArrangement(value: string): value is LocationArrangement {
  return (ALL_ARRANGEMENTS as readonly string[]).includes(value);
}

/** What made an arrangement fail: the opening's places, or its time zones. */
type FailedOn = 'places' | 'timezones' | null;

function checkArrangement(
  opening: Opening,
  arrangement: LocationArrangement,
  profile: MatchProfile,
  idx: PlaceIndex,
): { outcome: CheckOutcome; failedOn: FailedOn } {
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
    if (!fits) return { outcome: 'fail', failedOn: 'timezones' };
  }
  return { outcome, failedOn: outcome === 'fail' ? 'places' : null };
}

/**
 * Whether the opening's outcome rests on an unsure value. `confidence` describes the
 * description-sourced parts (time zones always are); a part from LinkedIn is sure.
 * A failure rests on the arrangement when the profile wants one the opening rules out
 * and the opening might fit with its arrangement unstated (`fitsUnstated`), and on each
 * part that failed a kept arrangement.
 */
function openingUnsure(
  opening: Opening,
  outcome: CheckOutcome,
  ruledOut: boolean,
  failedOn: FailedOn[],
  fitsUnstated: () => boolean,
): boolean {
  if (opening.confidence !== 'unsure' || outcome === 'unknown') return false;
  const arrangement = opening.arrangementSource === 'description';
  const places = opening.placesSource === 'description';
  if (outcome === 'pass') return arrangement || places;
  return (
    failedOn.some((f) => f === 'timezones' || (f === 'places' && places)) ||
    (ruledOut && arrangement && fitsUnstated())
  );
}

function checkOpening(
  opening: Opening,
  profile: MatchProfile,
  idx: PlaceIndex,
): {
  outcome: CheckOutcome;
  deciding: LocationArrangement | null;
  kept: LocationArrangement[];
  unsure: boolean;
} {
  // The most favourable arrangement: the opening checked as if it stated none. Not a
  // sure failure means the ruled-out arrangement might be what fails. Nothing is ruled
  // out of an unstated opening, so this does not recurse further.
  const fitsUnstated = () => {
    const r = checkOpening(
      { ...opening, arrangements: ['unstated'] },
      profile,
      idx,
    );
    return r.outcome !== 'fail' || r.unsure;
  };
  const stated = opening.arrangements.filter(isArrangement);
  const onlyUnstated = !opening.arrangements.some((a) => a !== 'unstated');
  const expanded = opening.arrangements.includes('unstated')
    ? [...new Set([...stated, ...ALL_ARRANGEMENTS])]
    : stated;
  const wanted = (a: LocationArrangement) => profile.locations[a].length > 0;
  const kept = expanded.filter(wanted);
  const ruledOut = ALL_ARRANGEMENTS.some(
    (a) => wanted(a) && !expanded.includes(a),
  );
  if (kept.length === 0) {
    return {
      outcome: 'fail',
      deciding: null,
      kept,
      unsure: openingUnsure(opening, 'fail', ruledOut, [], fitsUnstated),
    };
  }
  const results = kept.map((a) => ({
    arrangement: a,
    ...checkArrangement(opening, a, profile, idx),
  }));
  const best = bestOutcome(results.map((r) => r.outcome));
  const outcome = onlyUnstated && best === 'pass' ? 'unknown' : best;
  const deciding = results.find((r) => r.outcome === best);
  return {
    outcome,
    deciding: deciding?.arrangement ?? null,
    kept,
    unsure: openingUnsure(
      opening,
      outcome,
      ruledOut,
      results.map((r) => r.failedOn),
      fitsUnstated,
    ),
  };
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
  // A failure is unsure when any opening's failure is: that opening might fit.
  // A pass is unsure when every passing opening's pass is.
  const unsure =
    outcome === 'fail'
      ? per.some((p) => p.unsure)
      : outcome === 'pass' &&
        per.filter((p) => p.outcome === 'pass').every((p) => p.unsure);
  const detail = per.map((p) => ({
    arrangements: p.opening.arrangements,
    places: p.opening.places,
    placeStrictness: p.opening.placeStrictness,
    timezones: p.opening.timezones,
    decidedBy: p.deciding,
    outcome: p.outcome,
    unsure: p.unsure,
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
    ...restsOn(unsure ? 'openings' : null),
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
