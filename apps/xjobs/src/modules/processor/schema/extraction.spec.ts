import { describe, expect, it } from 'vitest';
import { LIST_NAMES } from '../vocab/lists';
import type { DecisionQuestion } from '../models/types';
import { extractionDocumentSchema } from './extraction';
import { fixtureDocument } from './fixture';
import {
  modelOutputJsonSchema,
  modelOutputSchema,
  type ListOptions,
} from './model-output';

const options = Object.fromEntries(
  LIST_NAMES.map((n) => [n, ['a', 'b']]),
) as ListOptions;
options.seniorities = ['junior', 'senior'];
const fallback: DecisionQuestion[] = [
  {
    key: 'seniority',
    kind: 'choice',
    options: ['junior', 'senior'],
    instructions: 'x',
  },
];

describe('extractionDocumentSchema', () => {
  it('parses a full valid document', () => {
    expect(extractionDocumentSchema.safeParse(fixtureDocument()).success).toBe(
      true,
    );
  });

  it('rejects unstated strictness with places', () => {
    const doc = fixtureDocument();
    doc.openings[0].placeStrictness = 'unstated';
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects fromUtc out of range', () => {
    const doc = fixtureDocument();
    doc.openings[0].timezones[0].fromUtc = 15;
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects an opening with no arrangements', () => {
    const doc = fixtureDocument();
    doc.openings[0].arrangements = [];
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

describe('modelOutputSchema', () => {
  it('rejects a seniority outside the options', () => {
    const valid = (s: string) => ({
      value: s,
      quote: '',
      confidence: 'sure',
    });
    const base = {
      position: { value: null, quote: '', confidence: 'sure' },
      isSoftwareEngineeringRole: { value: true, quote: '', confidence: 'sure' },
      seniority: valid('staff'),
      yearsRequired: { value: null, quote: '', confidence: 'sure' },
      arrangement: { value: null, quote: '', confidence: 'sure' },
      openings: [
        {
          arrangements: ['a'],
          places: [],
          placeStrictness: 'unstated',
          timezones: [],
          quote: '',
          confidence: 'sure',
        },
      ],
      contractType: { value: null, quote: '', confidence: 'sure' },
      engagement: { value: null, quote: '', confidence: 'sure' },
      contractMonths: { value: null, quote: '', confidence: 'sure' },
      salary: { value: null, quote: '', confidence: 'sure' },
      techStack: { value: null, quote: '', confidence: 'sure' },
      requiredLanguages: { value: null, quote: '', confidence: 'sure' },
      workAuthorization: { value: null, quote: '', confidence: 'sure' },
      junkFlags: { value: null, quote: '', confidence: 'sure' },
      fallback: { seniority: valid('junior') },
    };
    const schema = modelOutputSchema(options, fallback);
    expect(schema.safeParse(base).success).toBe(false);
    expect(
      schema.safeParse({ ...base, seniority: valid('senior') }).success,
    ).toBe(true);
  });

  it('produces a JSON schema with additionalProperties false at the root', () => {
    const json = modelOutputJsonSchema(options, fallback) as {
      additionalProperties?: boolean;
    };
    expect(json.additionalProperties).toBe(false);
  });
});
