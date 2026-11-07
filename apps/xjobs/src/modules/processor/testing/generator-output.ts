/**
 * A sample posting and a valid generator output for it, shared by the
 * pipeline and processor tests.
 */
import type { DecisionAnswer, DecisionQuestion } from '../models/types';

export const DESCRIPTION =
  'Senior Backend Engineer, remote in EMEA. Full-time employee role. We use Node.js and PostgreSQL.';

/** What the generator answers, and Jev agrees with, for each closed question. */
export const CLOSED: Record<string, string | boolean> = {
  arrangement: 'remote',
  seniority: 'senior',
  roleKind: 'backend_engineer',
  contractType: 'full_time',
  engagement: 'employee',
  isSoftwareEngineeringRole: true,
  sponsorshipOffered: 'unstated',
};

const closedValue = (key: string) =>
  key.startsWith('junk:') ? false : CLOSED[key];

/**
 * Jev's answers: agrees with `CLOSED` at 0.95, except where `picks` gives
 * another value or score for a key.
 */
export const jevAnswers =
  (picks: Record<string, { value?: string | boolean; score?: number }> = {}) =>
  (_: unknown, questions: DecisionQuestion[]): DecisionAnswer[] =>
    questions.map((q) => ({
      key: q.key,
      value: picks[q.key]?.value ?? closedValue(q.key),
      score: picks[q.key]?.score ?? 0.95,
    }));

export const mf = <T>(value: T, quote = '', confidence = 'sure') => ({
  value,
  quote,
  confidence,
});

/** A valid generator output for `DESCRIPTION`; `patch` replaces top-level keys. */
export function generatorOutput(patch: Record<string, unknown> = {}) {
  return {
    position: mf(
      { roleKind: 'backend_engineer', title: 'Backend Engineer' },
      'Senior Backend Engineer',
    ),
    isSoftwareEngineeringRole: mf(true, 'Backend Engineer'),
    seniority: mf('senior', 'Senior'),
    yearsRequired: mf(null),
    arrangement: mf('remote', 'remote in EMEA'),
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'limit',
        timezones: [],
        quote: 'remote in EMEA',
        confidence: 'sure',
      },
    ],
    contractType: mf('full_time', 'Full-time'),
    engagement: mf('employee', 'employee'),
    contractMonths: mf(null),
    salary: mf(null),
    techStack: mf({
      requirements: [
        {
          technology: { text: 'Node.js', code: null },
          kind: 'main',
          importance: 9,
          domain: null,
          years: null,
          quote: 'Node.js',
          confidence: 'sure',
          group: null,
        },
        {
          technology: { text: 'PostgreSQL', code: 'postgresql' },
          kind: 'nice',
          importance: 2,
          domain: null,
          years: null,
          quote: 'PostgreSQL',
          confidence: 'sure',
          group: null,
        },
      ],
      groups: [],
    }),
    requiredLanguages: mf([]),
    workAuthorization: mf({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: mf([]),
    ...patch,
  };
}
