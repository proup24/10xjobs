import { describe, expect, it } from 'vitest';
import type { Evidence, PostingInput } from '../models/types';
import type { ModelOutput } from '../schema';
import { resolveFacts } from './resolve-facts';

const GEN = 'anthropic/opus';

const evidence = (p: Partial<Evidence> = {}): Evidence => ({
  location: null,
  contractType: null,
  experienceLevel: null,
  salary: null,
  ...p,
});

const input = (e: Evidence): PostingInput => ({
  jobId: 'j1',
  title: 'Backend Engineer',
  companyName: 'Acme',
  description: 'We hire.',
  truncated: false,
  evidence: e,
});

const mf = <T>(
  value: T | null,
  confidence: 'sure' | 'unsure' = 'sure',
  quote = '',
) => ({
  value,
  quote,
  confidence,
});

function output(patch: Record<string, unknown> = {}): ModelOutput {
  return {
    position: mf({ roleKind: 'backend_engineer', title: 'Backend Engineer' }),
    isSoftwareEngineeringRole: mf(true),
    seniority: mf('mid'),
    yearsRequired: mf(null),
    arrangement: mf('remote'),
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'worldwide' }],
        placeStrictness: 'mention',
        timezones: [],
        quote: '',
        confidence: 'sure',
      },
    ],
    contractType: mf('full_time'),
    engagement: mf('employee'),
    contractMonths: mf(null),
    salary: mf(null),
    techStack: mf({ requirements: [], groups: [] }),
    requiredLanguages: mf([]),
    workAuthorization: mf({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: mf([]),
    ...patch,
  } as unknown as ModelOutput;
}

const resolve = (out: ModelOutput, e: Evidence = evidence()) =>
  resolveFacts({ output: out, input: input(e), generatorModel: GEN });

const FACTS = [
  'position',
  'isSoftwareEngineeringRole',
  'seniority',
  'yearsRequired',
  'arrangement',
  'contractType',
  'engagement',
  'contractMonths',
  'salary',
  'techStack',
  'requiredLanguages',
  'workAuthorization',
  'junkFlags',
] as const;

describe('resolveFacts', () => {
  it('takes every fact from the generator, unverified', () => {
    const doc = resolve(output());
    for (const name of FACTS) {
      expect([name, doc[name]]).toMatchObject([
        name,
        {
          decidedBy: 'generator',
          score: null,
          verification: null,
          model: GEN,
        },
      ]);
    }
    expect(doc.openings[0].decidedBy).toBe('generator');
    expect(doc.seniority.value).toBe('mid');
  });

  it('records one round, nothing dropped, and no verifier', () => {
    const doc = resolve(output());
    expect(doc.verification).toEqual({
      rounds: 1,
      regenerationInvalid: false,
      dropped: [],
      missedJunkFlags: [],
    });
    expect(doc.models).toEqual({ verifier: null, generator: GEN });
    expect(doc.truncated).toBe(false);
  });

  it('fills an unstated seniority from evidence that maps to one code', () => {
    const doc = resolve(
      output({ seniority: mf('unstated') }),
      evidence({ experienceLevel: 'Entry level' }),
    );
    expect(doc.seniority).toEqual({
      value: 'junior',
      confidence: 'unsure',
      decidedBy: 'ingest',
      score: null,
      quote: '',
      model: null,
      verification: null,
    });
    expect(doc.conflicts).toEqual([]);
  });

  it('fills a null contractType from the evidence', () => {
    const doc = resolve(
      output({ contractType: mf(null) }),
      evidence({ contractType: 'Full-time' }),
    );
    expect(doc.contractType).toMatchObject({
      value: 'full_time',
      decidedBy: 'ingest',
      confidence: 'unsure',
      model: null,
    });
  });

  it('leaves seniority unstated when the evidence maps to several codes', () => {
    const doc = resolve(
      output({ seniority: mf('unstated') }),
      evidence({ experienceLevel: 'Mid-Senior level' }),
    );
    expect(doc.seniority).toMatchObject({
      value: 'unstated',
      decidedBy: 'generator',
    });
  });

  it('keeps a generator value that contradicts the evidence, and records the conflict', () => {
    const doc = resolve(
      output({ seniority: mf('senior', 'sure', 'Senior') }),
      evidence({ experienceLevel: 'Entry level' }),
    );
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      decidedBy: 'generator',
      confidence: 'sure',
    });
    expect(doc.conflicts).toEqual([
      {
        field: 'seniority',
        ingestValue: 'Entry level',
        extractedValue: 'senior',
      },
    ]);
  });

  it('records no conflict for a generator value the evidence allows', () => {
    const doc = resolve(
      output({ seniority: mf('senior') }),
      evidence({ experienceLevel: 'Mid-Senior level' }),
    );
    expect(doc.conflicts).toEqual([]);
  });

  it('records a contractType conflict', () => {
    const doc = resolve(
      output({ contractType: mf('contract') }),
      evidence({ contractType: 'Full-time' }),
    );
    expect(doc.contractType.value).toBe('contract');
    expect(doc.conflicts).toEqual([
      {
        field: 'contractType',
        ingestValue: 'Full-time',
        extractedValue: 'contract',
      },
    ]);
  });

  it("takes the sponsorship from the generator's workAuthorization", () => {
    const out = output({
      workAuthorization: mf({ requirements: [], sponsorship: 'yes' }, 'unsure'),
    });
    const doc = resolve(out);
    expect(doc.workAuthorization.value?.sponsorship).toBe('yes');
    expect(doc.workAuthorization.confidence).toBe('unsure');
    expect(doc.workAuthorization.decidedBy).toBe('generator');
  });

  it("takes the junk flags from the generator's output", () => {
    const doc = resolve(
      output({
        junkFlags: mf([{ code: 'spam', quote: 'buy now' }], 'unsure'),
      }),
    );
    expect(doc.junkFlags.value).toEqual([{ code: 'spam', quote: 'buy now' }]);
    expect(doc.junkFlags.confidence).toBe('unsure');
  });

  it('records a salary conflict and keeps the posting value', () => {
    const doc = resolve(
      output({
        salary: mf({
          min: 80000,
          max: 100000,
          currency: 'EUR',
          period: 'year',
        }),
      }),
      evidence({
        salary: {
          text: null,
          min: 50000,
          max: 100000,
          currency: 'EUR',
          period: 'yearly',
        },
      }),
    );
    expect(doc.salary.value?.min).toBe(80000);
    expect(doc.conflicts).toContainEqual({
      field: 'salary',
      ingestValue: {
        min: 50000,
        max: 100000,
        currency: 'EUR',
        period: 'yearly',
      },
      extractedValue: {
        min: 80000,
        max: 100000,
        currency: 'EUR',
        period: 'year',
      },
    });
  });

  it('records a salary conflict when only the period differs', () => {
    const out = output({
      salary: mf({ min: 50, max: 60, currency: 'EUR', period: 'hour' }),
    });
    const salary = (period: string) =>
      resolve(
        out,
        evidence({
          salary: { text: null, min: 50, max: 60, currency: 'EUR', period },
        }),
      ).conflicts.filter((c) => c.field === 'salary');
    expect(salary('yearly')).toHaveLength(1);
    expect(salary('HOURLY')).toEqual([]);
  });

  it('takes the evidence salary when the posting has none', () => {
    const doc = resolve(
      output(),
      evidence({
        salary: {
          text: null,
          min: 50000,
          max: 60000,
          currency: 'USD',
          period: 'yearly',
        },
      }),
    );
    expect(doc.salary).toMatchObject({
      value: { min: 50000, max: 60000, currency: 'USD', period: 'year' },
      decidedBy: 'ingest',
      confidence: 'unsure',
      model: null,
      verification: null,
    });
  });

  it('marks an opening taken from the listing as ingest and unsure', () => {
    const out = output();
    (out.openings[0] as { fromListing?: boolean }).fromListing = true;
    const doc = resolve(out);
    expect(doc.openings[0]).toMatchObject({
      decidedBy: 'ingest',
      confidence: 'unsure',
    });
    expect(doc.openings[0]).not.toHaveProperty('fromListing');
  });
});
