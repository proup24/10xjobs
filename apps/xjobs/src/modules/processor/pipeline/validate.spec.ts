import { describe, expect, it } from 'vitest';
import type { PostingInput } from '../models/types';
import { fixtureDocument } from '../schema/fixture.testing';
import {
  checkConsistency,
  checkQuotes,
  needsReview,
  normalizeForQuote,
} from './validate';

const input = (description: string): PostingInput => ({
  jobId: 'j',
  title: null,
  companyName: null,
  description,
  truncated: false,
  evidence: {
    location: null,
    contractType: null,
    experienceLevel: null,
    salary: null,
  },
});

describe('normalizeForQuote', () => {
  it('normalizes quotes, dashes, whitespace and case', () => {
    expect(normalizeForQuote('“Type Script” – x\n\ty')).toBe(
      '"type script" - x y',
    );
  });
});

/** The fixture's own quotes are not in the test inputs; clear them so only the quote under test counts. */
function quietDocument() {
  const doc = fixtureDocument();
  doc.openings[0].quote = '';
  doc.requiredLanguages.value![0].quote = '';
  return doc;
}

describe('checkQuotes', () => {
  it('passes a quote found in the input', () => {
    const doc = quietDocument();
    doc.seniority.quote = '5+ years';
    const r = checkQuotes(doc, input('We need 5+ years of experience'));
    expect(r.quoteFailures).toBe(0);
    expect(r.doc.seniority.quote).toBe('5+ years');
  });

  it('matches curly quotes against straight ones', () => {
    const doc = quietDocument();
    doc.seniority.quote = '“TypeScript”';
    expect(
      checkQuotes(doc, input('we use "TypeScript" daily')).quoteFailures,
    ).toBe(0);
  });

  it('clears a quote that is not in the input and downgrades the fact', () => {
    const doc = quietDocument();
    doc.seniority.quote = 'made up';
    const r = checkQuotes(doc, input('nothing here'));
    expect(r.quoteFailures).toBe(1);
    expect(r.doc.seniority).toMatchObject({ quote: '', confidence: 'unsure' });
    expect(doc.seniority.quote).toBe('made up');
  });
});

describe('checkConsistency', () => {
  it('downgrades arrangement and openings when they disagree', () => {
    const doc = fixtureDocument();
    doc.arrangement.value = 'remote';
    doc.openings[0].arrangements = ['hybrid'];
    const out = checkConsistency(doc);
    expect(out.arrangement.confidence).toBe('unsure');
    expect(out.openings[0].confidence).toBe('unsure');
  });

  it('accepts an unstated arrangement', () => {
    const doc = fixtureDocument();
    doc.arrangement.value = 'unstated';
    doc.openings[0].arrangements = ['hybrid'];
    expect(checkConsistency(doc).arrangement.confidence).toBe('sure');
  });

  it('downgrades a non-engineering flag with an engineering role kind', () => {
    const doc = fixtureDocument();
    doc.isSoftwareEngineeringRole.value = false;
    doc.position.value = { roleKind: 'backend_engineer', title: 't' };
    const out = checkConsistency(doc);
    expect(out.isSoftwareEngineeringRole.confidence).toBe('unsure');
    expect(out.position.confidence).toBe('unsure');
  });

  it('downgrades an engineering flag with a non-engineering role kind', () => {
    const doc = fixtureDocument();
    doc.position.value = { roleKind: 'support', title: 't' };
    const out = checkConsistency(doc);
    expect(out.isSoftwareEngineeringRole.confidence).toBe('unsure');
    expect(out.position.confidence).toBe('unsure');
  });
});

describe('needsReview', () => {
  it('is true for an unsure seniority', () => {
    const doc = fixtureDocument();
    doc.seniority.confidence = 'unsure';
    expect(needsReview(doc)).toBe(true);
  });
  it('is true for conflicts', () => {
    const doc = fixtureDocument();
    doc.conflicts.push({ field: 'x', ingestValue: 1, extractedValue: 2 });
    expect(needsReview(doc)).toBe(true);
  });
  it('is false otherwise', () => {
    expect(needsReview(fixtureDocument())).toBe(false);
  });
});
