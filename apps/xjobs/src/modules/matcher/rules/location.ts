import type { FactOpening as Opening } from 'src/modules/facts/schema/facts';
import {
  LOCATION_ARRANGEMENTS,
  type LocationArrangement,
} from 'src/modules/queries';
import { overlaps, type Overlap, type PlaceIndex } from './places';
import { homePlaces, livesIn, residenceApplies } from './residence';
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

/**
 * What made an arrangement fail: the opening's places, a place it merely mentions (binding
 * a hybrid or onsite opening), where the user lives, or its time zones.
 */
type FailedOn = 'places' | 'mention' | 'residence' | 'timezones' | null;

/** Whether the user lives inside the opening's strict places, when that is checked. */
type Residence = { homes: string[]; fits: Overlap } | null;

/** The stored residence detail: also whether the check decided the remote arrangement. */
type ResidenceDetail = (NonNullable<Residence> & { decided: boolean }) | null;

function checkArrangement(
  opening: Opening,
  arrangement: LocationArrangement,
  profile: MatchProfile,
  idx: PlaceIndex,
  residence: Residence,
): { outcome: CheckOutcome; failedOn: FailedOn } {
  let outcome: CheckOutcome;
  let mentionFailed = false;
  if (opening.places.length === 0) {
    outcome = 'unknown';
  } else {
    const found = new Set<Overlap>();
    for (const jobPlace of opening.places)
      for (const profilePlace of profile.locations[arrangement])
        found.add(overlaps(jobPlace, profilePlace, idx));
    if (found.has('yes')) outcome = 'pass';
    else if (found.has('maybe')) outcome = 'unknown';
    else if (opening.placeStrictness === 'mention' && arrangement === 'remote')
      outcome = 'unknown';
    else {
      outcome = 'fail';
      mentionFailed = opening.placeStrictness === 'mention';
    }
  }
  // A remote job limited to places stated in the description wants someone living there.
  let failedOnResidence = false;
  if (arrangement === 'remote' && residence && outcome !== 'fail') {
    if (residence.fits === 'no') {
      outcome = 'fail';
      failedOnResidence = true;
    } else if (residence.fits === 'maybe') outcome = 'unknown';
  }
  if (arrangement === 'remote' && opening.timezones.length > 0) {
    const fits = opening.timezones.some(
      (tz) =>
        tz.fromUtc <= profile.timezoneMax / 60 &&
        tz.toUtc >= profile.timezoneMin / 60,
    );
    if (!fits) return { outcome: 'fail', failedOn: 'timezones' };
  }
  if (failedOnResidence) return { outcome, failedOn: 'residence' };
  if (outcome !== 'fail') return { outcome, failedOn: null };
  return { outcome, failedOn: mentionFailed ? 'mention' : 'places' };
}

/**
 * Whether the opening's outcome rests on an unsure value. `confidence` describes the
 * description-sourced parts (time zones always are); a part from LinkedIn is sure.
 * A failure rests on the arrangement when the profile wants one the opening rules out
 * and the opening might fit with its arrangement unstated (`fitsUnstated`), and on each
 * part that failed a kept arrangement. A mentioned place that failed a hybrid or onsite
 * opening is sure, so it never counts as unsure and settles the arrangement too.
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
    failedOn.some(
      (f) =>
        f === 'timezones' || f === 'residence' || (f === 'places' && places),
    ) ||
    (ruledOut && arrangement && !failedOn.includes('mention') && fitsUnstated())
  );
}

function checkOpening(
  opening: Opening,
  profile: MatchProfile,
  idx: PlaceIndex,
  homes: string[],
  unstatedAs: 'office' | 'any' = 'office',
): {
  outcome: CheckOutcome;
  deciding: LocationArrangement | null;
  kept: LocationArrangement[];
  unsure: boolean;
  residence: ResidenceDetail;
} {
  // The most favourable arrangement: the opening checked as if it stated none. Not a
  // sure failure means the ruled-out arrangement might be what fails. Nothing is ruled
  // out of an unstated opening checked as 'any', so this does not recurse further.
  const fitsUnstated = () => {
    const r = checkOpening(
      { ...opening, arrangements: ['unstated'] },
      profile,
      idx,
      homes,
      'any',
    );
    return r.outcome !== 'fail' || r.unsure;
  };
  const stated = opening.arrangements.filter(isArrangement);
  const onlyUnstated = !opening.arrangements.some((a) => a !== 'unstated');
  // An opening no source gives an arrangement is checked as office-based, and its
  // failure is sure: nothing says it could be remote.
  const asOffice = onlyUnstated && unstatedAs === 'office';
  const expanded: LocationArrangement[] = asOffice
    ? ['onsite', 'hybrid']
    : opening.arrangements.includes('unstated')
      ? [...new Set([...stated, ...ALL_ARRANGEMENTS])]
      : stated;
  const wanted = (a: LocationArrangement) => profile.locations[a].length > 0;
  const kept = expanded.filter(wanted);
  const ruledOut = ALL_ARRANGEMENTS.some(
    (a) => wanted(a) && !expanded.includes(a),
  );
  const residence: Residence = residenceApplies(opening, homes)
    ? { homes, fits: livesIn(opening.places, homes, idx) }
    : null;
  if (kept.length === 0) {
    return {
      outcome: 'fail',
      deciding: null,
      kept,
      unsure:
        !asOffice && openingUnsure(opening, 'fail', ruledOut, [], fitsUnstated),
      residence: null,
    };
  }
  const results = kept.map((a) => ({
    arrangement: a,
    ...checkArrangement(opening, a, profile, idx, residence),
  }));
  const best = bestOutcome(results.map((r) => r.outcome));
  const outcome =
    onlyUnstated && !asOffice && best === 'pass' ? 'unknown' : best;
  const deciding = results.find((r) => r.outcome === best);
  return {
    outcome,
    deciding: deciding?.arrangement ?? null,
    kept,
    unsure:
      !asOffice &&
      openingUnsure(
        opening,
        outcome,
        ruledOut,
        results.map((r) => r.failedOn),
        fitsUnstated,
      ),
    residence:
      residence && kept.some((a) => a === 'remote')
        ? {
            ...residence,
            decided: results.some((r) => r.failedOn === 'residence'),
          }
        : null,
  };
}

/** Whether any opening's arrangement, place and time zone fit where the profile works. */
export function checkLocation(
  openings: Opening[],
  profile: MatchProfile,
  idx: PlaceIndex,
): Check {
  const homes = homePlaces(profile.eligibility);
  const per = openings.map((opening) => ({
    opening,
    ...checkOpening(opening, profile, idx, homes),
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
    residence: p.residence,
  }));
  const jobValue = openings.map((o) => ({
    arrangements: o.arrangements,
    places: o.places,
  }));
  const wanted = Object.fromEntries(
    ALL_ARRANGEMENTS.map((a) => [a, profile.locations[a]]),
  );

  const arrangementsText = (list: string[]) => list.join('/');
  const textOf = (list: Opening[]) =>
    list
      .map(
        (o) =>
          `${arrangementsText(o.arrangements)}${o.places.length ? ` in ${o.places.map(placeText).join(', ')}` : ''}`,
      )
      .join('; ');
  const jobText = textOf(openings);
  const residenceFailed = per
    .filter((p) => p.residence?.decided)
    .map((p) => p.opening);
  const profileText = ALL_ARRANGEMENTS.filter(
    (a) => profile.locations[a].length > 0,
  ).join(', ');
  const verb =
    outcome === 'pass'
      ? 'fits'
      : outcome === 'unknown'
        ? 'may fit'
        : 'does not fit';
  const noArrangement =
    openings.length > 0 &&
    openings.every((o) => o.arrangements.every((a) => a === 'unstated'));
  const reason =
    outcome === 'fail' && residenceFailed.length > 0
      ? `job location (${textOf(residenceFailed)}, stated in the description) requires living there; you live in ${homes.join(', ')}`
      : `${outcome === 'fail' && noArrangement ? 'no source states the arrangement, so it is checked as office-based: ' : ''}job location (${jobText || 'not stated'}) ${verb} your wanted arrangements (${profileText || 'none'})`;
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
