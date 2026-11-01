import { describe, expect, it } from 'vitest';
import type {
  DecisionAnswer,
  DecisionQuestion,
  Evidence,
  PostingInput,
} from '../models/types';
import type { ModelOutput } from '../schema';
import { resolveFacts, selectFallback } from './resolve-facts';

const DEC = 'typesafe/jev-1.14';
const EXT = 'anthropic/opus';

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

const choice = (key: DecisionQuestion['key']): DecisionQuestion => ({
  key,
  kind: 'choice',
  options: ['a', 'b'],
  instructions: '',
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

function output(
  fallback: Record<string, ReturnType<typeof mf>> = {},
): ModelOutput {
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
    techStack: mf({ mainStack: [], mustHaves: [], niceToHaves: [] }),
    requiredLanguages: mf([]),
    workAuthorization: mf({ requirements: [], sponsorship: 'unstated' }),
    junkFlags: mf([]),
    fallback,
  } as unknown as ModelOutput;
}

const ans = (
  key: DecisionAnswer['key'],
  value: DecisionAnswer['value'],
  score: number,
): DecisionAnswer => ({ key, value, score });

const models = { decision: DEC, extraction: EXT };

describe('selectFallback', () => {
  it('keeps confident agreeing answers out of the fallback', () => {
    const qs = [choice('seniority')];
    expect(
      selectFallback([ans('seniority', 'senior', 0.9)], qs, evidence(), DEC),
    ).toEqual([]);
  });

  it('sends low-score answers', () => {
    const qs = [choice('seniority')];
    expect(
      selectFallback([ans('seniority', 'senior', 0.5)], qs, evidence(), DEC),
    ).toEqual(qs);
  });

  it('sends contradicting answers even when confident', () => {
    const qs = [choice('contractType')];
    const e = evidence({ contractType: 'Full-time' });
    expect(
      selectFallback([ans('contractType', 'contract', 0.95)], qs, e, DEC),
    ).toEqual(qs);
  });

  it('sends everything for an unknown decision model', () => {
    const qs = [choice('seniority'), choice('engagement')];
    expect(
      selectFallback(
        [ans('seniority', 'senior', 0.99), ans('engagement', 'employee', 0.99)],
        qs,
        evidence(),
        'other/model',
      ),
    ).toEqual(qs);
  });

  it('sends a question with no answer', () => {
    const qs = [choice('seniority')];
    expect(selectFallback([], qs, evidence(), DEC)).toEqual(qs);
  });
});

describe('resolveFacts', () => {
  it('lets a confident agreeing Jev answer stand', () => {
    const doc = resolveFacts({
      output: output(),
      answers: [ans('seniority', 'senior', 0.9)],
      fallback: [],
      input: input(evidence({ experienceLevel: 'Mid-Senior level' })),
      models,
    });
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      decidedBy: 'jev',
      confidence: 'sure',
      score: 0.9,
      model: DEC,
    });
  });

  it('uses Opus for a fallback question and keeps its unsure', () => {
    const doc = resolveFacts({
      output: output({ seniority: mf('senior', 'unsure', '') }),
      answers: [ans('seniority', 'junior', 0.5)],
      fallback: [choice('seniority')],
      input: input(evidence()),
      models,
    });
    expect(doc.seniority).toMatchObject({
      value: 'senior',
      decidedBy: 'opus',
      confidence: 'unsure',
      model: EXT,
    });
  });

  it('records a conflict when Jev contradicts the evidence', () => {
    const doc = resolveFacts({
      output: output({ contractType: mf('full_time', 'sure') }),
      answers: [ans('contractType', 'contract', 0.95)],
      fallback: [choice('contractType')],
      input: input(evidence({ contractType: 'Full-time' })),
      models,
    });
    expect(doc.conflicts).toEqual([
      {
        field: 'contractType',
        ingestValue: 'Full-time',
        extractedValue: 'contract',
      },
    ]);
    expect(doc.contractType.decidedBy).toBe('opus');
  });

  it('falls back to the evidence when Opus says unstated', () => {
    const doc = resolveFacts({
      output: output({ contractType: mf('unstated', 'sure') }),
      answers: [ans('contractType', 'unstated', 0.3)],
      fallback: [choice('contractType')],
      input: input(evidence({ contractType: 'Full-time' })),
      models,
    });
    expect(doc.contractType).toMatchObject({
      value: 'full_time',
      decidedBy: 'ingest',
      confidence: 'unsure',
      model: null,
    });
  });

  it('builds the open facts from Opus', () => {
    const doc = resolveFacts({
      output: output(),
      answers: [],
      fallback: [],
      input: input(evidence()),
      models,
    });
    expect(doc.yearsRequired.decidedBy).toBe('opus');
    expect(doc.openings[0].decidedBy).toBe('opus');
    expect(doc.models).toEqual(models);
    expect(doc.truncated).toBe(false);
  });

  it('keeps workAuthorization unsure when Opus was unsure of the requirements', () => {
    const out = output({ sponsorshipOffered: mf('yes', 'sure') });
    out.workAuthorization.confidence = 'unsure';
    const doc = resolveFacts({
      output: out,
      answers: [ans('sponsorshipOffered', 'yes', 0.95)],
      fallback: [],
      input: input(evidence()),
      models,
    });
    expect(doc.workAuthorization.value?.sponsorship).toBe('yes');
    expect(doc.workAuthorization.confidence).toBe('unsure');
  });

  it('marks junk flags unsure when an unsure Opus answer changes them', () => {
    const doc = resolveFacts({
      output: output({ 'junk:spam': mf(true, 'unsure', '') }),
      answers: [ans('junk:spam', true, 0.4)],
      fallback: [{ key: 'junk:spam', kind: 'yesno', instructions: '' }],
      input: input(evidence()),
      models,
    });
    expect(doc.junkFlags.value).toEqual([{ code: 'spam', quote: '' }]);
    expect(doc.junkFlags.confidence).toBe('unsure');
  });

  it('records a salary conflict and keeps the posting value', () => {
    const out = output();
    out.salary = mf({
      min: 80000,
      max: 100000,
      currency: 'EUR',
      period: 'year',
    }) as never;
    const doc = resolveFacts({
      output: out,
      answers: [],
      fallback: [],
      input: input(
        evidence({
          salary: {
            text: null,
            min: 50000,
            max: 100000,
            currency: 'EUR',
            period: 'yearly',
          },
        }),
      ),
      models,
    });
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

  it('takes the evidence salary when the posting has none', () => {
    const doc = resolveFacts({
      output: output(),
      answers: [],
      fallback: [],
      input: input(
        evidence({
          salary: {
            text: null,
            min: 50000,
            max: 60000,
            currency: 'USD',
            period: 'yearly',
          },
        }),
      ),
      models,
    });
    expect(doc.salary).toMatchObject({
      value: { min: 50000, max: 60000, currency: 'USD', period: 'year' },
      decidedBy: 'ingest',
      confidence: 'unsure',
      model: null,
    });
  });

  it('marks an opening taken from the listing as ingest and unsure', () => {
    const out = output();
    (out.openings[0] as { fromListing?: boolean }).fromListing = true;
    const doc = resolveFacts({
      output: out,
      answers: [],
      fallback: [],
      input: input(evidence()),
      models,
    });
    expect(doc.openings[0]).toMatchObject({
      decidedBy: 'ingest',
      confidence: 'unsure',
    });
    expect(doc.openings[0]).not.toHaveProperty('fromListing');
  });
});
