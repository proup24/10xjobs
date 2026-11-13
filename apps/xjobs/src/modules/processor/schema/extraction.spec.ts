import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LIST_NAMES } from '../vocab/lists';
import {
  EXTRACTION_SCHEMA_VERSION,
  extractionDocumentSchema,
  parseStoredDocument,
} from './extraction';
import { extractionDocumentV1Schema } from './extraction-v1';
import { extractionDocumentV2Schema } from './extraction-v2';
import {
  extractionDocumentV3Schema,
  verificationSchema,
} from './extraction-v3';
import { factSchema } from './fact';
import { fixtureDocument } from './fixture.testing';
import { fixtureDocumentV1 } from './fixture-v1.testing';
import { fixtureDocumentV2 } from './fixture-v2.testing';
import { fixtureDocumentV3 } from './fixture-v3.testing';
import {
  modelOutputJsonSchema,
  modelOutputSchema,
  type ListOptions,
} from './model-output';

const options = Object.fromEntries(
  LIST_NAMES.map((n) => [n, ['a', 'b']]),
) as ListOptions;
options.seniorities = ['junior', 'senior'];

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

  it('is schema version 4', () => {
    expect(EXTRACTION_SCHEMA_VERSION).toBe(4);
  });

  it('a v4 document has no conflicts key', () => {
    const doc = fixtureDocument();
    expect(doc).not.toHaveProperty('conflicts');
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(true);
    expect(
      extractionDocumentSchema.safeParse({ ...doc, conflicts: [] }).success,
    ).toBe(false);
  });

  it('rejects an ingest decider', () => {
    const doc = fixtureDocument();
    (doc.seniority as { decidedBy: string }).decidedBy = 'ingest';
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects a document with a verification summary', () => {
    expect(
      extractionDocumentSchema.safeParse({
        ...fixtureDocument(),
        verification: {
          rounds: 1,
          regenerationInvalid: false,
          dropped: [],
          missedJunkFlags: [],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects models.verifier, and takes only the generator model', () => {
    const doc = fixtureDocument();
    expect(doc.models).toEqual({ generator: 'm' });
    expect(
      extractionDocumentSchema.safeParse({
        ...doc,
        models: { verifier: null, generator: 'm' },
      }).success,
    ).toBe(false);
  });

  it('rejects a fact with a verification', () => {
    const doc = fixtureDocument();
    expect(
      extractionDocumentSchema.safeParse({
        ...doc,
        seniority: { ...doc.seniority, verification: null },
      }).success,
    ).toBe(false);
  });
  it('rejects a v1 document', () => {
    expect(
      extractionDocumentSchema.safeParse(fixtureDocumentV1()).success,
    ).toBe(false);
  });
});

describe('fact envelope', () => {
  const schema = factSchema(z.string());
  const fact = {
    value: 'senior',
    confidence: 'sure',
    decidedBy: 'generator',
    score: null,
    quote: '',
    model: 'm',
  };

  it('is decided by the generator only', () => {
    expect(schema.safeParse(fact).success).toBe(true);
    expect(schema.safeParse({ ...fact, decidedBy: 'ingest' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...fact, decidedBy: 'jev' }).success).toBe(false);
    expect(schema.safeParse({ ...fact, decidedBy: 'opus' }).success).toBe(
      false,
    );
  });

  it('has no verification', () => {
    expect(schema.safeParse({ ...fact, verification: null }).success).toBe(
      false,
    );
  });
});

describe('extractionDocumentV3Schema', () => {
  it('parses a document stored at version 3, verification included', () => {
    expect(
      extractionDocumentV3Schema.safeParse(fixtureDocumentV3()).success,
    ).toBe(true);
  });

  it('rejects a v4 document', () => {
    expect(
      extractionDocumentV3Schema.safeParse(fixtureDocument()).success,
    ).toBe(false);
  });

  it("checks Jev's verification", () => {
    const verification = {
      verdict: 'confirmed',
      score: 0.9,
      jevPick: 'senior',
      rounds: 1,
    };
    expect(verificationSchema.safeParse(verification).success).toBe(true);
    expect(
      verificationSchema.safeParse({ ...verification, verdict: 'maybe' })
        .success,
    ).toBe(false);
    expect(
      verificationSchema.safeParse({ ...verification, score: 2 }).success,
    ).toBe(false);
    expect(
      verificationSchema.safeParse({ ...verification, rounds: 0 }).success,
    ).toBe(false);
  });
});

describe('extractionDocumentV2Schema', () => {
  it('parses a document stored at version 2, conflicts included', () => {
    expect(
      extractionDocumentV2Schema.safeParse(fixtureDocumentV2()).success,
    ).toBe(true);
  });

  it('reads an ingest-decided fact and a listing-filled opening', () => {
    const doc = fixtureDocumentV2();
    doc.seniority.decidedBy = 'ingest';
    doc.openings[0].decidedBy = 'ingest';
    doc.conflicts.push({
      field: 'seniority',
      ingestValue: 'x',
      extractedValue: 'y',
    });
    expect(extractionDocumentV2Schema.safeParse(doc).success).toBe(true);
  });
});

describe('extractionDocumentV1Schema', () => {
  it('parses a document stored before version 2', () => {
    expect(
      extractionDocumentV1Schema.safeParse(fixtureDocumentV1()).success,
    ).toBe(true);
  });

  it('rejects a v2 document', () => {
    expect(
      extractionDocumentV1Schema.safeParse(fixtureDocument()).success,
    ).toBe(false);
  });
});

describe('parseStoredDocument', () => {
  it('reads a v4 document as version 4', () => {
    expect(parseStoredDocument(fixtureDocument())).toEqual({
      version: 4,
      document: fixtureDocument(),
    });
  });

  it('reads a stored v3 document as version 3', () => {
    expect(parseStoredDocument(fixtureDocumentV3())).toEqual({
      version: 3,
      document: fixtureDocumentV3(),
    });
  });

  it('parseStoredDocument still reads a stored v2 document as version 2', () => {
    expect(parseStoredDocument(fixtureDocumentV2())).toEqual({
      version: 2,
      document: fixtureDocumentV2(),
    });
  });

  it('falls back to v1 for an old row', () => {
    expect(parseStoredDocument(fixtureDocumentV1())).toEqual({
      version: 1,
      document: fixtureDocumentV1(),
    });
  });

  it('is null for data neither version reads', () => {
    expect(parseStoredDocument({ nope: true })).toBeNull();
  });
});

describe('document tech stack and years', () => {
  it('rejects a stack the assembler rules reject, at its path', () => {
    const doc = fixtureDocument();
    const nice = doc.techStack.value!.requirements.find(
      (r) => r.kind === 'nice',
    )!;
    nice.importance = 6;
    const parsed = extractionDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path.slice(0, 3)).toEqual([
      'techStack',
      'value',
      'requirements',
    ]);
  });

  it('rejects an unknown skill domain', () => {
    const doc = fixtureDocument();
    (doc.techStack.value!.requirements[0] as { domain: string }).domain =
      'cooking';
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('takes yearsRequired as a range and rejects max below min', () => {
    const doc = fixtureDocument();
    doc.yearsRequired.value = { min: 3, max: 5 };
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(true);
    doc.yearsRequired.value = { min: 5, max: 3 };
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

describe('work authorization requirements', () => {
  const withRequirement = (kind: string) => {
    const doc = fixtureDocument();
    doc.workAuthorization.value = {
      requirements: [{ kind, place: 'US' }] as never,
      sponsorship: 'unstated',
    };
    return extractionDocumentSchema.safeParse(doc).success;
  };

  it('accepts the four kinds', () => {
    for (const kind of ['work-permit', 'citizenship', 'residency', 'clearance'])
      expect(withRequirement(kind)).toBe(true);
  });

  it('rejects any other kind', () => {
    expect(withRequirement('visa')).toBe(false);
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
    };
    const schema = modelOutputSchema(options);
    expect(schema.safeParse(base).success).toBe(false);
    expect(
      schema.safeParse({ ...base, seniority: valid('senior') }).success,
    ).toBe(true);
    // No Jev fallback any more: the generator answers every field at top level.
    expect(
      schema.safeParse({
        ...base,
        seniority: valid('senior'),
        fallback: { seniority: valid('junior') },
      }).success,
    ).toBe(false);
  });

  it('throws when a list has no approved options', () => {
    expect(() => modelOutputSchema({ ...options, regions: [] })).toThrow(
      'no approved options for regions',
    );
  });

  it('produces a JSON schema with additionalProperties false at the root', () => {
    const json = modelOutputJsonSchema(options) as {
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
    const nodes = objects(modelOutputJsonSchema(options));

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
