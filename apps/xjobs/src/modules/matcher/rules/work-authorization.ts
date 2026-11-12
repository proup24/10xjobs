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

/** A country code: two letters that are not a known region (`EU` is a region). */
const isCountry = (code: string, idx: PlaceIndex): boolean =>
  /^[A-Z]{2}$/.test(code) && !idx.countriesOfRegion.has(code);

/** The countries a country or region code covers, or null when the index cannot say. */
function countriesOf(code: string, idx: PlaceIndex): Set<string> | null {
  if (isCountry(code, idx)) return new Set([code]);
  const countries = idx.countriesOfRegion.get(code);
  return countries && countries.size > 0 ? countries : null;
}

/**
 * Whether an authorization for `held` covers a requirement for `required`: the same
 * place, a required place inside the held one (a region covers its countries and the
 * regions within it), or a held country inside a required region (a posting naming a
 * region asks for one of its countries). `maybe` when the index cannot place either.
 */
function covers(held: string, required: string, idx: PlaceIndex): Overlap {
  if (held === required) return 'yes';
  const heldCountries = countriesOf(held, idx);
  const requiredCountries = countriesOf(required, idx);
  if (!heldCountries || !requiredCountries) return 'maybe';
  if ([...requiredCountries].every((c) => heldCountries.has(c))) return 'yes';
  return isCountry(held, idx) && requiredCountries.has(held) ? 'yes' : 'no';
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
  const requirements = value?.requirements ?? [];
  if (!value || requirements.length === 0)
    return {
      ...base,
      outcome: 'unknown',
      reason: 'job states no work authorization requirement',
      ...restsOn(null),
    };
  const unmet: Requirement[] = [];
  const unclear: Requirement[] = [];
  for (const r of requirements) {
    const o = meets(r, eligibility, idx);
    if (o === 'no') unmet.push(r);
    else if (o === 'maybe') unclear.push(r);
  }
  // Requirements and sponsorship share one confidence: when it is unsure either may be
  // wrong, so a failure could pass and a pass could fail.
  const sureness = restsOn(
    facts.workAuthorization.confidence === 'unsure'
      ? 'workAuthorization'
      : null,
  );
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
