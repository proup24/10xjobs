import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { decide, type MatchContext } from './decide';
import { exampleProfile, factsDoc } from './fixtures.testing';
import type { MatchJob } from './types';

const ctx: MatchContext = {
  places: { countriesOfRegion: new Map(), countryOfCity: new Map() },
  implies: new Map(),
};

const worldwide = {
  arrangements: ['remote'],
  places: [{ kind: 'worldwide' }],
  placeStrictness: 'limit',
  timezones: [],
  quote: '',
  confidence: 'sure',
  arrangementSource: 'description',
  placesSource: 'description',
} as unknown as JobFactsDocument['openings'][number];

const passingDoc = (edit?: (d: JobFactsDocument) => void) =>
  factsDoc((d) => {
    d.position.value = { roleKind: 'backend_engineer', title: 'Backend' };
    d.seniority.value = 'senior';
    d.openings = [structuredClone(worldwide)];
    d.techStack.value = {
      requirements: [
        {
          technology: { text: 'Python', code: 'python' },
          kind: 'main',
          importance: 9,
          domain: null,
          years: null,
          quote: '',
          confidence: 'sure',
          group: null,
        },
      ],
      groups: [],
    };
    edit?.(d);
  });

const job = (facts: JobFactsDocument, needsReview = false): MatchJob => ({
  jobId: 'j1',
  extractionId: 'e1',
  factsHash: 'h1',
  needsReview,
  facts,
});

describe('decide', () => {
  it('always returns four checks in order, even after a fail', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.position.value = { roleKind: 'data_engineer', title: 'x' };
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.checks.map((c) => c.rule)).toEqual([
      'position',
      'seniority',
      'location',
      'stack',
    ]);
  });

  it('rejects a job that fails one rule, not unverified', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.position.value = { roleKind: 'data_engineer', title: 'x' };
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.outcome).toBe('rejected');
    expect(d.unverified).toBe(false);
  });

  it('qualifies when everything passes', () => {
    const d = decide(job(passingDoc()), exampleProfile(), ctx);
    expect(d.checks.map((c) => c.outcome)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
    expect(d.stackScore).toBeGreaterThan(0);
  });

  it('flags unverified when the extraction needs review', () => {
    const d = decide(job(passingDoc(), true), exampleProfile(), ctx);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(true);
  });

  it('flags unverified when a check is unknown', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.seniority.value = 'unstated';
          x.yearsRequired.value = null;
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.checks.some((c) => c.outcome === 'unknown')).toBe(true);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(true);
  });

  it('rejects when neither the role nor the stack can be verified', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.position.value = { roleKind: 'unstated', title: 'x' };
          x.techStack.value = null;
        }),
        true,
      ),
      exampleProfile(),
      ctx,
    );
    const position = d.checks.find((c) => c.rule === 'position');
    expect(d.outcome).toBe('rejected');
    expect(d.unverified).toBe(false);
    expect(position?.outcome).toBe('fail');
    expect(position?.reason).toMatch(/neither the role nor the stack/);
    expect(d.checks.find((c) => c.rule === 'stack')?.outcome).toBe('unknown');
  });

  it('still qualifies an unstated role when the stack passes', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.position.value = { roleKind: 'unstated', title: 'x' };
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(true);
  });

  it('golden 1288: fullstack job is rejected on position and stack', () => {
    const file = join(__dirname, '../../processor/golden/cases/1288.json');
    const { expected } = JSON.parse(readFileSync(file, 'utf8'));
    const doc = factsDoc((x) => {
      x.position.value = { roleKind: expected.roleKind, title: 'x' };
      x.seniority.value = expected.seniority;
      x.yearsRequired.value = expected.yearsRequired;
      x.openings = expected.openings.map((o: object) => ({
        ...structuredClone(worldwide),
        ...o,
      }));
      x.techStack.value = {
        requirements: expected.requirements.map(
          (r: { text: string; code: string; kind: 'main' }) => ({
            technology: { text: r.text, code: r.code },
            kind: r.kind,
            importance: 8,
            domain: null,
            years: null,
            quote: '',
            confidence: 'sure',
            group: null,
          }),
        ),
        groups: [],
      };
    });
    const d = decide(job(doc), exampleProfile(), ctx);
    const by = Object.fromEntries(d.checks.map((c) => [c.rule, c.outcome]));
    expect(d.outcome).toBe('rejected');
    expect(by.position).toBe('fail');
    expect(by.stack).toBe('fail');
    expect(d.unverified).toBe(false);
    expect(by.seniority).toBe('unknown');
    expect(by.location).toBe('unknown');
  });

  describe('review', () => {
    const berlinOnsite = {
      ...structuredClone(worldwide),
      arrangements: ['onsite'],
      places: [
        { kind: 'city', name: 'Berlin', countryCode: 'DE', cityId: 'berlin' },
      ],
    } as JobFactsDocument['openings'][number];

    it('a sure fail rejects', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.seniority.value = 'junior';
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('rejected');
      expect(d.review).toBeNull();
    });

    it('an unsure fail with no sure fail is review, with rule and field', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.seniority.value = 'junior';
            x.seniority.confidence = 'unsure';
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual({ rule: 'seniority', field: 'seniority' });
      expect(d.unverified).toBe(false);
    });

    it('the first unsure fail in rule order is the review', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.seniority.value = 'junior';
            x.seniority.confidence = 'unsure';
            x.position.value = { roleKind: 'data_engineer', title: 'x' };
            x.position.confidence = 'unsure';
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual({ rule: 'position', field: 'position' });
    });

    it('a sure fail beats an unsure fail', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.seniority.value = 'junior';
            x.seniority.confidence = 'unsure';
            x.position.value = { roleKind: 'data_engineer', title: 'x' };
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('rejected');
      expect(d.review).toBeNull();
    });

    it('an unsure pass stays qualified and unverified', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.seniority.confidence = 'unsure';
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('qualified');
      expect(d.unverified).toBe(true);
      expect(d.review).toBeNull();
    });

    it('a LinkedIn opening counts as sure', () => {
      const p = exampleProfile();
      p.locations.remote = [];
      const d = decide(
        job(
          passingDoc((x) => {
            x.openings = [
              {
                ...berlinOnsite,
                placeStrictness: 'label',
                arrangementSource: 'linkedin',
                placesSource: 'linkedin',
                confidence: 'sure',
              },
            ];
          }),
        ),
        p,
        ctx,
      );
      expect(d.checks.find((c) => c.rule === 'location')).toMatchObject({
        outcome: 'fail',
        unsure: false,
      });
      expect(d.outcome).toBe('rejected');
    });

    it('an unsure description opening that does not fit is review on openings', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.openings = [
              {
                ...berlinOnsite,
                placeStrictness: 'limit',
                confidence: 'unsure',
              },
            ];
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual({ rule: 'location', field: 'openings' });
    });

    it('neither role nor stack verifiable is a sure rejection, even on unsure facts', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.position.value = { roleKind: 'unstated', title: 'x' };
            x.position.confidence = 'unsure';
            x.techStack.value = null;
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.checks[0]).toMatchObject({ outcome: 'fail', unsure: false });
      expect(d.outcome).toBe('rejected');
    });
  });
});
