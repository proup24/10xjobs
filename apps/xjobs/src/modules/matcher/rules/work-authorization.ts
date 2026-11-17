import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import type { Overlap, PlaceIndex } from './places';
import { restsOn, type Check, type MatchProfile } from './types';

type Requirement = NonNullable<
  JobFactsDocument['workAuthorization']['value']
>['requirements'][number];

/** The authorization kinds that meet each required kind. */
const MET_BY: Record<Requirement['kind'], string[]> = {
  citizenship: ['citizenship'],
  'work-permit': ['work-permit', 'citizenship'],
  residency: ['residency', 'citizenship'],
  clearance: ['clearance'],
};

/** Kinds a job's visa sponsorship can make up for. */
const SPONSORABLE = new Set<string>(['work-permit', 'residency']);

const RANK: Record<Overlap, number> = { yes: 2, maybe: 1, no: 0 };

/**
 * A known country code: two letters in the countries vocabulary and not a region (`EU` is a
 * region). A non-ISO code such as `UK` is not one, so it stays `maybe` rather than a sure `no`.
 */
const isCountry = (code: string, idx: PlaceIndex): boolean =>
  /^[A-Z]{2}$/.test(code) &&
  idx.countries.has(code) &&
  !idx.countriesOfRegion.has(code);

/** The countries a country or region code covers, or null when the index cannot say. */
function countriesOf(code: string, idx: PlaceIndex): Set<string> | null {
  if (isCountry(code, idx)) return new Set([code]);
  const countries = idx.countriesOfRegion.get(code);
  return countries && countries.size > 0 ? countries : null;
}

/** Requirement places that name everywhere: met by any authorization of a fitting kind. */
const EVERYWHERE = new Set(['GLOBAL', 'WORLDWIDE']);

/**
 * Whether an authorization for `held` covers a requirement for `required` (codes compared
 * upper-cased): a requirement for everywhere, the same code, a required country inside the
 * held place, or a required region that shares a country with the held place (a posting
 * naming a region asks for one of its countries). `maybe` when the index cannot place either.
 */
function covers(held: string, required: string, idx: PlaceIndex): Overlap {
  const h = held.toUpperCase();
  const r = required.toUpperCase();
  if (EVERYWHERE.has(r) || h === r) return 'yes';
  const heldCountries = countriesOf(h, idx);
  const requiredCountries = countriesOf(r, idx);
  if (!heldCountries || !requiredCountries) return 'maybe';
  if (isCountry(r, idx)) return heldCountries.has(r) ? 'yes' : 'no';
  for (const c of requiredCountries) if (heldCountries.has(c)) return 'yes';
  return 'no';
}

function meets(
  req: Requirement,
  eligibility: MatchProfile['eligibility'],
  idx: PlaceIndex,
): Overlap {
  const held = eligibility.authorizations
    .filter((a) => MET_BY[req.kind].includes(a.kind))
    .map((a) => a.place);
  if (req.kind === 'residency' && eligibility.residenceCountry !== null)
    held.push(eligibility.residenceCountry);
  let best: Overlap = 'no';
  for (const place of held) {
    const o = covers(place, req.place, idx);
    if (RANK[o] > RANK[best]) best = o;
  }
  return best;
}

const label = (r: Requirement) => `${r.kind} ${r.place}`;

/** Sorts requirements into those the user meets, cannot meet, and cannot be told about. */
function classify(
  requirements: Requirement[],
  eligibility: MatchProfile['eligibility'],
  idx: PlaceIndex,
) {
  const met: Requirement[] = [];
  const unmet: Requirement[] = [];
  const unclear: Requirement[] = [];
  for (const r of requirements) {
    const o = meets(r, eligibility, idx);
    if (o === 'no') unmet.push(r);
    else if (o === 'maybe') unclear.push(r);
    else met.push(r);
  }
  return { met, unmet, unclear };
}

const NO_SPONSORSHIP = '(the job offers no sponsorship)';

/**
 * Every work authorization the job requires, met by the user's authorizations (through
 * the place hierarchy) or `residenceCountry`, or made up for by sponsorship.
 */
export function checkWorkAuthorization(
  facts: JobFactsDocument,
  profile: MatchProfile,
  idx: PlaceIndex,
): Check {
  const value = facts.workAuthorization.value;
  const eligibility = profile.eligibility;
  const base = {
    rule: 'workAuthorization' as const,
    jobValue: value,
    profileValue: eligibility,
  };
  const all = value?.requirements ?? [];
  // Requirements derived from no sponsorship are alternatives (one place is enough), unlike
  // the ones the posting states, which must all be met.
  const requirements = all.filter((r) => !r.derived);
  const derived = all.filter((r) => r.derived);
  // Requirements and sponsorship share one confidence: when it is unsure either may be
  // wrong, so a failure could pass and a pass could fail.
  const sureness = restsOn(
    facts.workAuthorization.confidence === 'unsure'
      ? 'workAuthorization'
      : null,
  );
  if (derived.length > 0) {
    const group = classify(derived, eligibility, idx);
    const detail = { unmet: group.unmet, unclear: group.unclear };
    const places = (rs: Requirement[]) =>
      rs.length === 1
        ? label(rs[0])
        : `work-permit in any of ${rs.map((r) => r.place).join(', ')}`;
    if (group.met.length === 0) {
      if (group.unclear.length > 0)
        return {
          ...base,
          outcome: 'unknown',
          reason: `cannot tell whether you meet ${places(group.unclear)} ${NO_SPONSORSHIP}`,
          detail,
          ...restsOn(null),
        };
      return {
        ...base,
        outcome: 'fail',
        reason: `you don't meet ${places(group.unmet)} ${NO_SPONSORSHIP}`,
        detail,
        ...sureness,
      };
    }
    if (requirements.length === 0)
      return {
        ...base,
        outcome: 'pass',
        reason: `you meet ${label(group.met[0])} ${NO_SPONSORSHIP}`,
        detail,
        ...sureness,
      };
  }
  if (!value || requirements.length === 0)
    return {
      ...base,
      // Nothing to check: a pass, never review or a reject. Where the job is, the
      // location check covers. On an unsure fact a requirement may have been missed,
      // so the pass rests on it and marks the match unverified.
      outcome: 'pass',
      reason:
        value?.sponsorship === 'no'
          ? `the job offers no sponsorship but names no place to check`
          : 'job states no work authorization requirement',
      ...sureness,
    };
  const { unmet, unclear } = classify(requirements, eligibility, idx);
  const detail = { unmet, unclear };

  if (unmet.length > 0) {
    const missing = unmet.map(label).join(', ');
    const unsponsorable = unmet.filter((r) => !SPONSORABLE.has(r.kind));
    const why =
      unsponsorable.length > 0
        ? `${unsponsorable.map(label).join(', ')} can't be sponsored`
        : value.sponsorship !== 'yes'
          ? 'the job does not offer sponsorship'
          : eligibility.acceptsSponsorship !== true
            ? 'you do not accept sponsorship'
            : null;
    if (why !== null)
      return {
        ...base,
        outcome: 'fail',
        reason: `you don't meet ${missing}, and ${why}`,
        detail,
        ...sureness,
      };
  }
  if (unclear.length > 0)
    return {
      ...base,
      outcome: 'unknown',
      reason: `cannot tell whether you meet ${unclear.map(label).join(', ')}`,
      detail,
      ...restsOn(null),
    };
  return {
    ...base,
    outcome: 'pass',
    reason:
      unmet.length > 0
        ? `the job offers sponsorship for ${unmet.map(label).join(', ')}, which you accept`
        : `you meet every requirement: ${requirements.map(label).join(', ')}`,
    detail,
    ...sureness,
  };
}
