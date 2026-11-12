import { describe, expect, it } from 'vitest';
import type { ModelOutput } from '../schema';
import { resolveFacts } from './resolve-facts';

const GEN = 'anthropic/opus';

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

const resolve = (out: ModelOutput) =>
  resolveFacts({ output: out, generatorModel: GEN });

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

  it('an unstated seniority stays unstated', () => {
    const doc = resolve(output({ seniority: mf('unstated') }));
    expect(doc.seniority).toMatchObject({
      value: 'unstated',
      decidedBy: 'generator',
      model: GEN,
    });
  });

  it('an unstated contract type stays as the generator gave it', () => {
    const doc = resolve(output({ contractType: mf(null) }));
    expect(doc.contractType).toMatchObject({
      value: null,
      decidedBy: 'generator',
    });
  });

  it('an unstated salary stays null', () => {
    const doc = resolve(output());
    expect(doc.salary).toMatchObject({ value: null, decidedBy: 'generator' });
  });

  it('keeps a generator salary as written', () => {
    const salary = { min: 80000, max: 100000, currency: 'EUR', period: 'year' };
    const doc = resolve(output({ salary: mf(salary, 'sure', '80k-100k') }));
    expect(doc.salary).toMatchObject({ value: salary, decidedBy: 'generator' });
  });

  it('has no conflicts key', () => {
    expect(resolve(output())).not.toHaveProperty('conflicts');
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

  it('takes every opening from the generator, whatever it carries', () => {
    const out = output();
    (out.openings[0] as { fromListing?: boolean }).fromListing = true;
    const doc = resolve(out);
    expect(doc.openings[0]).toMatchObject({
      decidedBy: 'generator',
      confidence: 'sure',
    });
  });
});
