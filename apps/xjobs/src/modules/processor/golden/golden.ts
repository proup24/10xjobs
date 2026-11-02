import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence } from '../models/types';

export type DraftedKey =
  | 'arrangement'
  | 'contractType'
  | 'isSoftwareEngineeringRole'
  | 'engagement';

export type GoldenPlace =
  | { kind: 'worldwide' }
  | { kind: 'region'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'city'; name: string; countryCode: string | null };

export interface GoldenTerm {
  text: string;
  code: string | null;
}

/** The values (no envelopes) of the spec section 5 facts, in xjobs codes. */
export interface GoldenFacts {
  roleKind: string;
  seniority: string;
  yearsRequired: number | null;
  contractMonths: number | null;
  openings: {
    arrangements: string[];
    places: GoldenPlace[];
    placeStrictness: string;
  }[];
  mainStack: { anyOf: GoldenTerm[] }[];
  requiredLanguages: { lang: string; level: string }[];
  sponsorship: 'yes' | 'no' | 'unstated';
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: string;
  } | null;
  junkFlags: string[];
  // Not in career-hub's golden values: drafted, then reviewed by a human.
  arrangement: string;
  contractType: string;
  isSoftwareEngineeringRole: boolean;
  engagement: string;
}

export interface GoldenCase {
  id: string;
  input: {
    title: string;
    companyName: string;
    description: string;
    evidence: Evidence;
  };
  expected: Partial<GoldenFacts>;
  /** A drafted value counts only once a human sets `reviewed: true`. */
  drafted: Partial<Record<DraftedKey, { value: unknown; reviewed: boolean }>>;
}

export const GOLDEN_CASES_DIR = join(__dirname, 'cases');

/** Every case in `cases/`, ordered by file name. */
export function loadGolden(dir: string = GOLDEN_CASES_DIR): GoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenCase);
}
