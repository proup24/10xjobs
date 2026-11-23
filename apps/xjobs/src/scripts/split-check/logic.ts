import { Channel } from 'src/common/enums';
import {
  linkedinMemberWords,
  mergedExperienceLevel,
  mergedLinkedinKeyword,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { linkedinKeyword } from 'src/modules/queries/channels/linkedin_keyword';
import { keywordUnits } from 'src/modules/segments/services/segments';

/** Rows each of the three runs may return. */
export const RUN_ROWS = 150;
/** Charge cap of one run. */
export const RUN_CAP_USD = 0.16;
/** The most the three runs may reserve together. */
export const TOTAL_CAP_USD = 0.5;
/** Share of the merged search's jobs the two halves must keep. */
export const PASS_SHARE = 0.95;
/** A group that returned more rows than this in 24 hours is too big for a 150-row check. */
export const MAX_GROUP_ROWS = 120;

export interface GroupCandidate {
  key: string;
  rows24h: number;
  members: { id: string; hash: string; params: Record<string, unknown> }[];
}

/** The named group, else the one with most rows in 24 hours under the limit. */
export function pickGroup(
  groups: readonly GroupCandidate[],
  key?: string,
): GroupCandidate {
  if (key !== undefined) {
    const named = groups.find((g) => g.key === key);
    if (!named) throw new Error(`no group with key ${key}`);
    return named;
  }
  const small = groups
    .filter((g) => g.rows24h < MAX_GROUP_ROWS)
    .sort((a, b) => b.rows24h - a.rows24h);
  if (small.length === 0) {
    throw new Error(`no group with under ${MAX_GROUP_ROWS} rows in 24 hours`);
  }
  return small[0];
}

/**
 * The merged keyword and its two halves. The group's keyword units
 * (`keywordUnits`: members of one keyword, any level) are halved in order,
 * first half rounded up (as the collector's `halve`); a lone unit has its
 * sorted spellings halved the same way.
 */
export function halfKeywords(group: GroupCandidate): {
  merged: string;
  halves: [string, string];
  by: 'members' | 'spellings';
} {
  const units = keywordUnits(Channel.LINKEDIN_JOB_BOARD, group.members);
  const members = units.flat();
  const merged = mergedLinkedinKeyword(members);
  if (units.length >= 2) {
    const half = Math.ceil(units.length / 2);
    return {
      merged,
      halves: [
        mergedLinkedinKeyword(units.slice(0, half).flat()),
        mergedLinkedinKeyword(units.slice(half).flat()),
      ],
      by: 'members',
    };
  }
  const { roleWords, spellings } = linkedinMemberWords(members);
  const sorted = [...new Set(spellings)].sort();
  if (sorted.length < 2) {
    throw new Error('cannot halve: one member with fewer than 2 spellings');
  }
  const half = Math.ceil(sorted.length / 2);
  return {
    merged,
    halves: [
      linkedinKeyword(roleWords, sorted.slice(0, half)),
      linkedinKeyword(roleWords, sorted.slice(half)),
    ],
    by: 'spellings',
  };
}

/**
 * The params the three runs search with: the first member's place and work
 * type, and the union of the members' levels (`mergedExperienceLevel`), as
 * the collector does.
 */
export function searchParams(group: GroupCandidate): Record<string, unknown> {
  return {
    ...group.members[0].params,
    experienceLevel: mergedExperienceLevel(group.members),
  };
}

/** Three runs, each reserving its charge cap. */
export function checkPlan(): {
  runs: 3;
  rows: 150;
  reservedUsd: number;
  fits: boolean;
} {
  const reservedUsd = 3 * RUN_CAP_USD;
  return {
    runs: 3,
    rows: 150,
    reservedUsd,
    fits: reservedUsd <= TOTAL_CAP_USD,
  };
}

/** How much of the merged search's jobs the two halves found together. */
export function coverage(
  merged: ReadonlySet<string>,
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): {
  merged: number;
  covered: number;
  share: number;
  halvesOnly: number;
  pass: boolean;
} {
  const covered = [...merged].filter((id) => a.has(id) || b.has(id)).length;
  const halves = new Set([...a, ...b]);
  const halvesOnly = [...halves].filter((id) => !merged.has(id)).length;
  const share = merged.size === 0 ? 0 : covered / merged.size;
  return {
    merged: merged.size,
    covered,
    share,
    halvesOnly,
    pass: merged.size > 0 && share >= PASS_SHARE,
  };
}

/**
 * Why a run cannot be judged: it returned the row limit (counted on items, not
 * distinct ids), it spent its cost cap (it may have stopped early and still
 * ended SUCCEEDED), or the merged run found nothing. An empty half is fine.
 */
export function inconclusive(
  itemCount: number,
  runCostUsd: number,
  role: 'merged' | 'half',
): 'full' | 'capped' | 'empty' | null {
  if (itemCount >= RUN_ROWS) return 'full';
  if (runCostUsd >= RUN_CAP_USD) return 'capped';
  if (role === 'merged' && itemCount === 0) return 'empty';
  return null;
}

/** An error message for a run that did not succeed (a partial dataset must not be judged), else null. */
export function runFailure(
  runId: string,
  status: string,
  costUsd: number,
): string | null {
  if (status === 'SUCCEEDED') return null;
  return `Apify run ${runId} ended ${status}, not SUCCEEDED; spend so far $${costUsd.toFixed(3)}`;
}
