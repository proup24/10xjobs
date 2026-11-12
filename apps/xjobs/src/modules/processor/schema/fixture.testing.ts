import type { ExtractionDocument } from './extraction';

const fact = <T>(value: T | null) => ({
  value,
  confidence: 'sure' as const,
  decidedBy: 'generator' as const,
  score: null,
  quote: '',
  model: 'm',
  verification: null,
});

const requirement = (
  technology: { text: string; code: string | null },
  kind: 'main' | 'must' | 'nice',
  importance: number,
) => ({
  technology,
  kind,
  importance,
  domain: null,
  years: null,
  quote: '',
  confidence: 'sure' as const,
  group: null,
});

export function fixtureDocument(): ExtractionDocument {
  return {
    position: fact({ roleKind: 'backend', title: 'Backend Engineer' }),
    isSoftwareEngineeringRole: fact(true),
    seniority: fact('senior'),
    yearsRequired: fact({ min: 5, max: null }),
    arrangement: fact('remote'),
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'limit',
        timezones: [{ fromUtc: 0, toUtc: 3, label: 'CET' }],
        quote: 'Remote in EMEA',
        confidence: 'sure',
        decidedBy: 'generator',
      },
    ],
    contractType: fact('full_time'),
    engagement: fact('employee'),
    contractMonths: fact(null),
    salary: fact({ min: 80000, max: 100000, currency: 'EUR', period: 'year' }),
    techStack: fact({
      requirements: [
        requirement({ text: 'Node', code: 'nodejs' }, 'main', 9),
        requirement({ text: 'SQL', code: 'sql' }, 'must', 6),
        requirement({ text: 'Rust', code: 'rust' }, 'nice', 2),
      ],
      groups: [],
    }),
    requiredLanguages: fact([
      { lang: 'en', level: 'fluent', quote: 'fluent English' },
    ]),
    workAuthorization: fact({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: fact([]),
    unmatched: [],
    truncated: false,
    verification: {
      rounds: 1,
      regenerationInvalid: false,
      dropped: [],
      missedJunkFlags: [],
    },
    models: { verifier: null, generator: 'm' },
  };
}
