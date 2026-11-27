/**
 * Input mapping for the LinkedIn job board actor,
 * `harvestapi/linkedin-job-search`. Everything that depends on the actor's
 * input format lives here; the collector only runs it. Builders keep storing
 * LinkedIn's `f_E` and `f_WT` codes; this maps them to the actor's names.
 */
import {
  linkedinKeyword,
  linkedinKeywordFits,
} from 'src/modules/queries/channels/linkedin_keyword';
import { locationKey } from 'src/modules/queries/steps/normalize';
import {
  LINKEDIN_GEO_IDS,
  WORLDWIDE,
} from 'src/modules/queries/channels/linkedin_geo';

export interface HarvestJobSearchInput {
  jobTitles: string[];
  geoIds: string[];
  experienceLevel?: string[];
  workplaceType?: string[];
  postedLimit: '1h';
  sortBy: 'date';
  maxItems: number;
}

const EXPERIENCE: Record<string, string> = {
  '1': 'internship',
  '2': 'entry',
  '3': 'associate',
  '4': 'mid-senior',
  '5': 'director',
};

const WORKPLACE: Record<string, string> = {
  '1': 'office',
  '2': 'remote',
  '3': 'hybrid',
};

/**
 * The geoId a search runs on: the builder's own when it has one, else the
 * verified one for its location (`GLOBAL` reads as `worldwide`; no location is
 * worldwide). The actor rejects place names as text, so a place without a
 * verified geoId throws instead of searching blind.
 */
export function linkedinGeoId(params: Record<string, unknown>): string {
  if (typeof params.geoId === 'string') return params.geoId;
  const location =
    typeof params.location === 'string' && params.location
      ? params.location
      : WORLDWIDE;
  const key = location === 'GLOBAL' ? WORLDWIDE : locationKey(location);
  const geoId = Object.hasOwn(LINKEDIN_GEO_IDS, key)
    ? LINKEDIN_GEO_IDS[key]
    : undefined;
  if (!geoId)
    throw new Error(
      `No LinkedIn geoId for location "${location}"; add it to LINKEDIN_GEO_IDS`,
    );
  return geoId;
}

/** The actor's names for a comma-separated code list; unknown codes drop, order kept. */
function mapCodes(value: unknown, names: Record<string, string>): string[] {
  if (typeof value !== 'string') return [];
  const mapped = value
    .split(',')
    .map((code) => code.trim())
    .filter((code) => Object.hasOwn(names, code))
    .map((code) => names[code]);
  return [...new Set(mapped)];
}

/** The actor input for one search; `maxItems` is its row limit. */
export function toHarvestJobSearchInput(
  keyword: string,
  params: Record<string, unknown>,
  maxItems: number,
): HarvestJobSearchInput {
  const experienceLevel = mapCodes(params.experienceLevel, EXPERIENCE);
  const workplaceType = mapCodes(params.workType, WORKPLACE);
  return {
    jobTitles: [keyword],
    geoIds: [linkedinGeoId(params)],
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
    postedLimit: '1h',
    sortBy: 'date',
    maxItems,
  };
}

/**
 * What a builder's search shares with others, comparable across builders:
 * canonical JSON of its place (its geoId) and mapped filters, without the
 * keyword. Segments group LinkedIn job board builders by it; their keywords
 * merge into one search.
 */
export function linkedinGroupKey(params: Record<string, unknown>): string {
  return groupKey(params, true);
}

/**
 * The group key without the experience level, for the harvestapi job board.
 * LinkedIn has ignored the `f_E` level filter since about 2026-11-18, so
 * harvestapi runs one search per place and work type across every level (see
 * docs/superpowers/specs/2026-11-23-merge-level-searches-design.md).
 */
export function harvestGroupKey(params: Record<string, unknown>): string {
  return groupKey(params, false);
}

function groupKey(params: Record<string, unknown>, withLevel: boolean): string {
  const experienceLevel = withLevel
    ? mapCodes(params.experienceLevel, EXPERIENCE).sort()
    : [];
  const workplaceType = mapCodes(params.workType, WORKPLACE).sort();
  return JSON.stringify({
    place: { geoId: linkedinGeoId(params) },
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
  });
}

/**
 * The union of the members' known `f_E` codes, sorted and comma-joined, for a
 * search that spans the levels of a merged group (harvestapi drops the level
 * from its group key; see `harvestGroupKey`). Undefined when there are no
 * members or any member has no level, since that member searches every level.
 * A member whose codes are all unknown (`','`, `'9'`) has no level: the actor
 * input drops unknown codes (`mapCodes`), so it searches every level too.
 */
export function mergedExperienceLevel(
  queries: readonly { params: Record<string, unknown> }[],
): string | undefined {
  if (!queries.length) return undefined;
  const codes = new Set<string>();
  for (const { params } of queries) {
    const level = params.experienceLevel;
    const known =
      typeof level === 'string'
        ? level
            .split(',')
            .map((code) => code.trim())
            .filter((code) => Object.hasOwn(EXPERIENCE, code))
        : [];
    if (known.length === 0) return undefined;
    for (const code of known) codes.add(code);
  }
  return [...codes].sort().join(',');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/** The union of the members' role words and spellings. */
export function linkedinMemberWords(
  queries: readonly { params: Record<string, unknown> }[],
): { roleWords: string[]; spellings: string[] } {
  return {
    roleWords: queries.flatMap(({ params }) => stringList(params.roleWords)),
    spellings: queries.flatMap(({ params }) => stringList(params.spellings)),
  };
}

/** One keyword for all members: `linkedinKeyword` over the union of their words. */
export function mergedLinkedinKeyword(
  queries: readonly { params: Record<string, unknown> }[],
): string {
  const { roleWords, spellings } = linkedinMemberWords(queries);
  return linkedinKeyword(roleWords, spellings);
}

/** LinkedIn's remote `f_WT` code. */
const REMOTE_WORK_TYPE = '2';

/** True when there are members and every one searches remote only. */
export function isRemoteSearch(
  queries: readonly { params: Record<string, unknown> }[],
): boolean {
  return (
    queries.length > 0 &&
    queries.every(({ params }) => params.workType === REMOTE_WORK_TYPE)
  );
}

/**
 * The keyword a LinkedIn job board run sends: {@link mergedLinkedinKeyword},
 * with ` AND remote` on a remote search when the word still fits LinkedIn's
 * limits. Segment chunking leaves room for it (`planSegments`); only a lone
 * keyword unit within 11 characters or one term of the limit goes without.
 */
export function linkedinBoardKeyword(
  queries: readonly { params: Record<string, unknown> }[],
): string {
  const { roleWords, spellings } = linkedinMemberWords(queries);
  const remote =
    isRemoteSearch(queries) &&
    linkedinKeywordFits(roleWords, spellings, { remote: true });
  return linkedinKeyword(roleWords, spellings, { remote });
}
