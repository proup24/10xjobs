import type { ExtractionDocumentV1 } from './extraction-v1';

const fact = <T>(value: T | null) => ({
  value,
  confidence: 'sure' as const,
  decidedBy: 'opus' as const,
  score: null,
  quote: '',
  model: 'm',
});

/** A document as stored before schema version 2, for the v1 read path. */
export function fixtureDocumentV1(): ExtractionDocumentV1 {
  return {
    position: fact({ roleKind: 'backend', title: 'Backend Engineer' }),
    isSoftwareEngineeringRole: fact(true),
    seniority: fact('senior'),
    yearsRequired: fact(5),
    arrangement: fact('remote'),
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EMEA' }],
        placeStrictness: 'limit',
        timezones: [{ fromUtc: 0, toUtc: 3, label: 'CET' }],
        quote: 'Remote in EMEA',
        confidence: 'sure',
        decidedBy: 'opus',
      },
    ],
    contractType: fact('full_time'),
    engagement: fact('employee'),
    contractMonths: fact(null),
    salary: fact({ min: 80000, max: 100000, currency: 'EUR', period: 'year' }),
    techStack: fact({
      mainStack: [{ anyOf: [{ text: 'Node', code: 'nodejs' }] }],
      mustHaves: [{ anyOf: [{ text: 'SQL', code: 'sql' }], min: 1 }],
      niceToHaves: [{ text: 'Rust', code: 'rust' }],
    }),
    requiredLanguages: fact([
      { lang: 'en', level: 'fluent', quote: 'fluent English' },
    ]),
    workAuthorization: fact({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: fact([]),
    conflicts: [],
    unmatched: [],
    truncated: false,
    models: { decision: null, extraction: 'm' },
  };
}
