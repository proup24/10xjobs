import { countriesOf, type PlaceIndex } from 'src/modules/matcher/rules/places';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import { PREFILTER_VERSION } from '../config/prefilter.config';
import { mentionsRemote } from './remote-words';

export interface OnSiteDemand {
  /** A profile wants hybrid or onsite somewhere we cannot narrow to countries. */
  anywhere: boolean;
  /** Uppercase country codes where a profile wants hybrid or onsite. */
  countries: Set<string>;
}

export interface PrefilterJob {
  workplaceType: string | null;
  countryCode: string | null;
  remoteAllowed: boolean | null;
  title: string | null;
  location: string | null;
  descriptionText: string | null;
}

export type SkipReason = {
  version: number;
  tag: 'hybrid' | 'onsite';
  country: string;
};

export type PrefilterResult =
  | {
      process: true;
      why:
        | 'tag'
        | 'no_tag'
        | 'no_country'
        | 'demand'
        | 'remote_allowed'
        | 'remote_words';
      matched?: string;
    }
  | { process: false; reason: SkipReason };

/** The countries where published profiles want hybrid or onsite work. */
export function onSiteDemand(
  profiles: { locations: PlacesByArrangement }[],
  idx: PlaceIndex,
): OnSiteDemand {
  const demand: OnSiteDemand = { anywhere: false, countries: new Set() };
  for (const profile of profiles) {
    for (const place of [
      ...profile.locations.hybrid,
      ...profile.locations.onsite,
    ]) {
      const countries = countriesOf(place, idx);
      if (!countries) {
        demand.anywhere = true;
        continue;
      }
      for (const c of countries) demand.countries.add(c.toUpperCase());
    }
  }
  return demand;
}

/** Whether a job must go to the processor. Every unclear case errs toward processing. */
export function checkBeforeProcessing(
  job: PrefilterJob,
  demand: OnSiteDemand,
): PrefilterResult {
  const tag = job.workplaceType;
  if (tag !== 'hybrid' && tag !== 'onsite') {
    return { process: true, why: tag === null ? 'no_tag' : 'tag' };
  }
  if (!job.countryCode) return { process: true, why: 'no_country' };
  const country = job.countryCode.toUpperCase();
  if (demand.anywhere || demand.countries.has(country)) {
    return { process: true, why: 'demand' };
  }
  if (job.remoteAllowed === true) {
    return { process: true, why: 'remote_allowed' };
  }
  for (const text of [job.title, job.location, job.descriptionText]) {
    const matched = text ? mentionsRemote(text) : null;
    if (matched) return { process: true, why: 'remote_words', matched };
  }
  return {
    process: false,
    reason: { version: PREFILTER_VERSION, tag, country },
  };
}
