import { describe, expect, it } from 'vitest';
import type { PostingInput } from '../models/types';
import { extractionDocumentSchema } from '../schema';
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

describe('normalizeForQuote invisibles', () => {
  it('strips soft hyphens and zero-width spaces and maps double primes', () => {
    expect(normalizeForQuote('Type\u00ADScr\u200Bipt')).toBe('typescript');
    expect(normalizeForQuote('5\u2033')).toBe('5"');
    expect(normalizeForQuote('5\u2032\u2032')).toBe('5"');
  });
});

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

describe('checkQuotes without a quote', () => {
  it('downgrades an Opus fact with a value and no quote', () => {
    const doc = quietDocument();
    doc.seniority.quote = '';
    const r = checkQuotes(doc, input('x'));
    expect(r.quoteFailures).toBe(0);
    expect(r.doc.seniority.confidence).toBe('unsure');
  });

  it('leaves Jev and ingest facts alone', () => {
    const doc = quietDocument();
    doc.seniority.decidedBy = 'jev';
    doc.contractType.decidedBy = 'ingest';
    const r = checkQuotes(doc, input('x'));
    expect(r.doc.seniority.confidence).toBe('sure');
    expect(r.doc.contractType.confidence).toBe('sure');
  });

  it('leaves an unestablished Opus fact alone', () => {
    const doc = quietDocument();
    doc.yearsRequired.value = null;
    doc.yearsRequired.quote = '';
    expect(checkQuotes(doc, input('x')).doc.yearsRequired.confidence).toBe(
      'sure',
    );
  });
});

describe('schema rules the validation relies on', () => {
  it('rejects fromUtc > toUtc', () => {
    const doc = fixtureDocument();
    doc.openings[0].timezones = [{ fromUtc: 5, toUtc: 1, label: 'x' }];
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it('rejects placeStrictness unstated with places', () => {
    const doc = fixtureDocument();
    doc.openings[0].placeStrictness = 'unstated';
    expect(extractionDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

const ENG: ReadonlySet<string> = new Set(['backend_engineer']);

describe('checkConsistency', () => {
  it('downgrades arrangement and openings when they disagree', () => {
    const doc = fixtureDocument();
    doc.arrangement.value = 'remote';
    doc.openings[0].arrangements = ['hybrid'];
    const out = checkConsistency(doc, ENG);
    expect(out.arrangement.confidence).toBe('unsure');
    expect(out.openings[0].confidence).toBe('unsure');
  });

  it('accepts an unstated arrangement', () => {
    const doc = fixtureDocument();
    doc.arrangement.value = 'unstated';
    doc.openings[0].arrangements = ['hybrid'];
    expect(checkConsistency(doc, ENG).arrangement.confidence).toBe('sure');
  });

  it('downgrades a non-engineering flag with an engineering role kind', () => {
    const doc = fixtureDocument();
    doc.isSoftwareEngineeringRole.value = false;
    doc.position.value = { roleKind: 'backend_engineer', title: 't' };
    const out = checkConsistency(doc, ENG);
    expect(out.isSoftwareEngineeringRole.confidence).toBe('unsure');
    expect(out.position.confidence).toBe('unsure');
  });

  it('downgrades an engineering flag with a non-engineering role kind', () => {
    const doc = fixtureDocument();
    doc.position.value = { roleKind: 'support', title: 't' };
    const out = checkConsistency(doc, ENG);
    expect(out.isSoftwareEngineeringRole.confidence).toBe('unsure');
    expect(out.position.confidence).toBe('unsure');
  });

  it('reads engineering role kinds from the set it is given', () => {
    const doc = fixtureDocument();
    doc.isSoftwareEngineeringRole.value = true;
    doc.position.value = { roleKind: 'backend_engineer', title: 't' };
    expect(
      checkConsistency(doc, new Set()).isSoftwareEngineeringRole.confidence,
    ).toBe('unsure');
    expect(
      checkConsistency(doc, ENG).isSoftwareEngineeringRole.confidence,
    ).toBe('sure');
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
