import { describe, expect, it } from 'vitest';
import { LIST_NAMES } from '../vocab/lists';
import type { DecisionQuestion } from '../models/types';
import { extractionDocumentSchema } from './extraction';
import { fixtureDocument } from './fixture.testing';
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

describe('document salary and unmatched', () => {
  it('rejects a bad currency and a non-integer salary', () => {
    const doc = fixtureDocument();
    doc.salary.value = { min: 1.5, max: 2, currency: 'eur', period: 'year' };
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it('rejects an unknown unmatched list', () => {
    const doc = fixtureDocument();
    (doc.unmatched as unknown[]).push({ list: 'nope', text: 'x', at: 'a' });
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

  it('throws when a list has no approved options', () => {
    expect(() =>
      modelOutputSchema({ ...options, regions: [] }, fallback),
    ).toThrow('no approved options for regions');
  });

  it('produces a JSON schema with additionalProperties false at the root', () => {
    const json = modelOutputJsonSchema(options, fallback) as {
      additionalProperties?: boolean;
    };
    expect(json.additionalProperties).toBe(false);
  });

  describe('strict structured output', () => {
    /** Every object node of the schema, with its path. */
    function objects(
      node: unknown,
      path = '$',
    ): [string, Record<string, unknown>][] {
      if (Array.isArray(node))
        return node.flatMap((n, i) => objects(n, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return [];
      const o = node as Record<string, unknown>;
      return [
        [path, o],
        ...Object.entries(o).flatMap(([k, v]) => objects(v, `${path}.${k}`)),
      ];
    }
    const nodes = objects(modelOutputJsonSchema(options, fallback));

    it('requires every property of every object, and allows no others', () => {
      for (const [path, o] of nodes) {
        if (o.type !== 'object') continue;
        const keys = Object.keys((o.properties ?? {}) as object);
        expect([path, [...((o.required as string[]) ?? [])].sort()]).toEqual([
          path,
          [...keys].sort(),
        ]);
        expect([path, o.additionalProperties]).toEqual([path, false]);
      }
    });

    it('uses only keywords strict mode accepts', () => {
      const allowed = new Set([
        'type',
        'properties',
        'required',
        'additionalProperties',
        'items',
        'anyOf',
        'enum',
        'const',
        'description',
      ]);
      const used = new Set(
        nodes.flatMap(([path, o]) =>
          // Keys under `properties` are field names, not keywords.
          path.endsWith('.properties') ? [] : Object.keys(o),
        ),
      );
      expect([...used].filter((k) => !allowed.has(k))).toEqual([]);
    });

    it('keeps the place union as anyOf, each branch tagged by kind', () => {
      const places = nodes.find(([p]) =>
        p.endsWith('.openings.items.properties.places.items'),
      )?.[1];
      expect(places?.anyOf).toHaveLength(4);
    });
  });
});

describe('work authorization requirement kinds', () => {
  const withKind = (kind: string) => {
    const doc = fixtureDocument();
    doc.workAuthorization.value = {
      // `kind` is deliberately unchecked here, so the schema is what refuses it.
      requirements: [{ kind: kind as never, place: 'US' }],
      sponsorship: 'unstated',
    };
    return doc;
  };
  it('refuses a kind outside the four', () => {
    expect(extractionDocumentSchema.safeParse(withKind('visa')).success).toBe(
      false,
    );
  });
  it.each(['work-permit', 'citizenship', 'residency', 'clearance'])(
    'accepts %s',
    (kind) => {
      expect(extractionDocumentSchema.safeParse(withKind(kind)).success).toBe(
        true,
      );
    },
  );
});
