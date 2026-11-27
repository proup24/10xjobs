import { describe, expect, it } from 'vitest';
import {
  arrangementLine,
  conflictLines,
  factQuotes,
  factLines,
  salaryLine,
  stackLines,
} from './facts';

const noSalary = {
  salaryText: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
} as unknown as Parameters<typeof salaryLine>[0];

describe('salaryLine', () => {
  it('prefers the job text, then its range, then the extracted salary', () => {
    expect(salaryLine({ ...noSalary, salaryText: '€80k', facts: null })).toBe(
      '€80k',
    );
    expect(
      salaryLine({
        ...noSalary,
        salaryMin: 70000,
        salaryMax: 90000,
        salaryCurrency: 'EUR',
        salaryPeriod: 'year',
        facts: null,
      } as Parameters<typeof salaryLine>[0]),
    ).toBe('EUR 70k–90k per year');
    expect(
      salaryLine({
        ...noSalary,
        facts: {
          salary: { min: 500, max: null, currency: 'USD', period: 'day' },
        },
      }),
    ).toBe('USD 500+ per day');
    expect(salaryLine({ ...noSalary, facts: {} })).toBeNull();
  });
});

describe('factLines', () => {
  it('is all null for an empty extraction', () => {
    expect(factLines({ ...noSalary, facts: null })).toEqual({
      role: null,
      seniority: null,
      arrangement: null,
      places: null,
      contractType: null,
      engagement: null,
      salary: null,
    });
  });

  it("reads the value lists' unstated code as not stated", () => {
    const unstated = { code: 'unstated', label: 'Unstated', quote: null };
    const facts = {
      position: {
        roleKind: { code: 'unstated', label: 'Unstated' },
        title: 'Senior Engineer, Core Services',
      },
      seniority: unstated,
      arrangement: unstated,
      contractType: unstated,
      engagement: unstated,
      openings: [],
    };
    expect(factLines({ ...noSalary, facts })).toEqual({
      role: { text: 'Senior Engineer, Core Services', source: 'description' },
      seniority: null,
      arrangement: null,
      places: null,
      contractType: null,
      engagement: null,
      salary: null,
    });
    expect(arrangementLine(facts)).toBeNull();
  });

  it('falls back to the openings for the arrangement, and words worldwide', () => {
    const facts = {
      openings: [
        {
          arrangements: [{ code: 'hybrid', label: 'Hybrid' }],
          places: [{ kind: 'worldwide' }],
          timezones: [],
        },
      ],
    };
    expect(arrangementLine(facts)).toBe('Hybrid');
    expect(factLines({ ...noSalary, facts }).places).toEqual({
      text: 'Worldwide',
      source: 'description',
    });
  });

  it('marks a LinkedIn arrangement', () => {
    const facts = {
      arrangement: {
        code: 'remote',
        label: 'Remote',
        source: 'linkedin',
        quote: null,
      },
      seniority: { code: 'senior', label: 'Senior', source: 'description' },
      openings: [
        {
          arrangements: [{ code: 'remote', label: 'Remote' }],
          places: [{ kind: 'country', code: 'MA', label: 'Morocco' }],
          timezones: [],
          arrangementSource: 'linkedin',
          placesSource: 'linkedin',
        },
      ],
      salary: {
        min: 500,
        max: null,
        currency: 'USD',
        period: 'day',
        source: 'linkedin',
      },
    };
    const lines = factLines({ ...noSalary, facts });
    expect(lines.arrangement).toEqual({ text: 'Remote', source: 'linkedin' });
    expect(lines.seniority).toEqual({ text: 'Senior', source: 'description' });
    expect(lines.places).toEqual({ text: 'Morocco', source: 'linkedin' });
    expect(lines.salary).toEqual({
      text: 'USD 500+ per day',
      source: 'linkedin',
    });
  });

  it('marks places and arrangement from LinkedIn separately, per opening part', () => {
    const opening = (arrangementSource: string, placesSource: string) => ({
      arrangements: [{ code: 'hybrid', label: 'Hybrid' }],
      places: [{ kind: 'country', code: 'FR', label: 'France' }],
      timezones: [],
      arrangementSource,
      placesSource,
    });
    const placesListed = factLines({
      ...noSalary,
      facts: { openings: [opening('description', 'linkedin')] },
    });
    expect(placesListed.places).toEqual({ text: 'France', source: 'linkedin' });
    expect(placesListed.arrangement).toEqual({
      text: 'Hybrid',
      source: 'description',
    });
    const arrangementListed = factLines({
      ...noSalary,
      facts: { openings: [opening('linkedin', 'description')] },
    });
    expect(arrangementListed.places).toEqual({
      text: 'France',
      source: 'description',
    });
    expect(arrangementListed.arrangement).toEqual({
      text: 'Hybrid',
      source: 'linkedin',
    });
    // A description top-level arrangement with LinkedIn places: only places are marked.
    const stated = factLines({
      ...noSalary,
      facts: {
        arrangement: { code: 'hybrid', label: 'Hybrid', source: 'description' },
        openings: [opening('description', 'linkedin')],
      },
    });
    expect(stated.arrangement).toEqual({
      text: 'Hybrid',
      source: 'description',
    });
    expect(stated.places).toEqual({ text: 'France', source: 'linkedin' });
  });

  it('takes the facts salary before the listing columns', () => {
    const facts = {
      salary: {
        min: 90000,
        max: null,
        currency: 'EUR',
        period: 'year',
        source: 'description',
      },
    };
    expect(
      factLines({
        ...noSalary,
        salaryText: '€80k',
        channels: ['LINKEDIN_JOB_BOARD'],
        facts,
      }).salary,
    ).toEqual({ text: 'EUR 90k+ per year', source: 'description' });
    expect(
      factLines({
        ...noSalary,
        salaryText: '€80k',
        channels: ['LINKEDIN_JOB_BOARD'],
        facts: null,
      }).salary,
    ).toEqual({ text: '€80k', source: 'linkedin' });
  });
});

describe('conflictLines', () => {
  it('words the listing side of each conflict by field', () => {
    expect(
      conflictLines([
        {
          field: 'arrangement',
          listingValue: 'onsite',
          descriptionValue: ['remote'],
          winner: 'description',
        },
        {
          field: 'places',
          listingValue: { kind: 'country', code: 'US', label: 'United States' },
          descriptionValue: [],
          winner: 'description',
        },
        { field: 'unknown', listingValue: 'x' },
      ]),
    ).toEqual({
      arrangement: 'The listing says onsite',
      places: 'The listing says United States',
    });
    expect(conflictLines(null)).toEqual({});
  });
});

describe('stackLines', () => {
  it('labels each code of a unit and keeps uncompared text as is', () => {
    const checks = [
      {
        rule: 'stack',
        detail: {
          covered: ['react or vue'],
          uncovered: ['go'],
          niceCovered: ['docker'],
          notComparable: ['Kubernetes'],
        },
      },
    ];
    const label = (c: string) => c.toUpperCase();
    expect(stackLines(checks, label)).toEqual({
      covered: ['REACT or VUE', 'DOCKER'],
      uncovered: ['GO'],
      notCompared: ['Kubernetes'],
    });
    expect(stackLines(null, label)).toEqual({
      covered: [],
      uncovered: [],
      notCompared: [],
    });
  });
});

describe('factQuotes', () => {
  it("reads a fact's quote, each opening's, or its parts'", () => {
    const facts = {
      seniority: { code: 'staff', quote: 'Lead as staff' },
      openings: [
        { quote: 'Remote in EU' },
        { quote: null },
        { quote: 'Remote in EU' },
      ],
      requiredLanguages: {
        quote: null,
        languages: [{ lang: 'fr', quote: 'French a must' }],
      },
      salary: { min: 1, quote: null },
    };
    expect(factQuotes(facts, 'seniority')).toEqual(['Lead as staff']);
    expect(factQuotes(facts, 'openings')).toEqual(['Remote in EU']);
    expect(factQuotes(facts, 'requiredLanguages')).toEqual(['French a must']);
    expect(factQuotes(facts, 'salary')).toEqual([]);
    expect(factQuotes(facts, 'isSoftwareEngineeringRole')).toEqual([]);
    expect(factQuotes(null, 'seniority')).toEqual([]);
  });
});
