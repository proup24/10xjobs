import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { decide, type MatchContext } from './decide';
import { exampleProfile, factsDoc, rolePost } from './fixtures.testing';
import type { PostContext } from './types';
import type { MatchJob } from './types';

const ctx: MatchContext = {
  places: {
    countriesOfRegion: new Map(),
    countryOfCity: new Map(),
    countries: new Set(),
  },
  implies: new Map(),
  rates: new Map(),
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
  post: null,
});

const roleJob = (post: Partial<PostContext> = {}): MatchJob => ({
  ...job(passingDoc()),
  post: rolePost(post),
});

describe('decide', () => {
  it('always returns ten checks in order, even after a fail', () => {
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
      'salary',
      'currency',
      'contractType',
      'languages',
      'postingLanguage',
      'workAuthorization',
    ]);
  });

  it('rejects a posting written only in a language the profile does not speak', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.postingLanguages = {
            codes: ['de'],
            closeCalls: [],
            confident: true,
          };
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.outcome).toBe('rejected');
    expect(d.checks.find((c) => c.rule === 'postingLanguage')).toMatchObject({
      outcome: 'fail',
      unsure: false,
    });
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
    // No salary minimum, and no currency, languages or authorization stated: nothing to
    // check passes, so only the posting language needs a fact.
    const d = decide(
      job(
        passingDoc((x) => {
          x.postingLanguages = {
            codes: ['en'],
            closeCalls: [],
            confident: true,
          };
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.checks.map((c) => c.outcome)).toEqual(
      Array.from({ length: 10 }, () => 'pass'),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
    expect(d.stackScore).toBeGreaterThan(0);
  });

  it('is not unverified when there is nothing to check: no minimum, no currency, languages or authorization stated', () => {
    const doc = passingDoc((x) => {
      x.postingLanguages = { codes: ['en'], closeCalls: [], confident: true };
      x.salary.value = null;
      x.requiredLanguages.value = [];
      x.workAuthorization.value = null;
    });
    const d = decide(job(doc), { ...exampleProfile(), salaryMin: null }, ctx);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
    for (const rule of ['salary', 'currency', 'languages', 'workAuthorization'])
      expect(d.checks.find((c) => c.rule === rule)?.outcome).toBe('pass');
  });

  it('an unsure "nothing stated" fact passes but makes a qualified job unverified', () => {
    for (const unsure of [
      (x: JobFactsDocument) => (x.salary.confidence = 'unsure'),
      (x: JobFactsDocument) => (x.requiredLanguages.confidence = 'unsure'),
      (x: JobFactsDocument) => (x.workAuthorization.confidence = 'unsure'),
    ]) {
      const doc = passingDoc((x) => {
        x.postingLanguages = { codes: ['en'], closeCalls: [], confident: true };
        x.salary.value = null;
        x.requiredLanguages.value = [];
        x.workAuthorization.value = null;
        unsure(x);
      });
      const d = decide(job(doc), { ...exampleProfile(), salaryMin: null }, ctx);
      expect(d.checks.map((c) => c.outcome)).toEqual(
        Array.from({ length: 10 }, () => 'pass'),
      );
      expect(d.outcome).toBe('qualified');
      expect(d.review).toBeNull();
      expect(d.unverified).toBe(true);
    }
  });

  it('qualified with an unknown contract type is not unverified', () => {
    const d = decide(
      job(
        passingDoc((x) => {
          x.contractType.value = 'unstated';
        }),
      ),
      exampleProfile(),
      ctx,
    );
    expect(d.checks.find((c) => c.rule === 'contractType')?.outcome).toBe(
      'unknown',
    );
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
  });

  it('qualified with an unsure seniority is unverified', () => {
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
  });

  it('qualified on a job with needsReview and no unsure check is not unverified', () => {
    const d = decide(job(passingDoc(), true), exampleProfile(), ctx);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
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

  describe('an unknown stack', () => {
    const nonComparable = (d: JobFactsDocument) => {
      d.techStack.value = {
        requirements: [
          {
            technology: { text: 'In-house tool', code: null },
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
    };
    const stackReview = { rule: 'stack', field: 'techStack' };

    it('a listing whose stack lists no requirements goes to review on stack/techStack', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.techStack.value = null;
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual(stackReview);
      expect(d.checks.find((c) => c.rule === 'stack')).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'techStack',
      });
    });

    it('a listing with only non-comparable requirements goes to review on stack/techStack', () => {
      const d = decide(job(passingDoc(nonComparable)), exampleProfile(), ctx);
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual(stackReview);
      expect(d.checks.find((c) => c.rule === 'stack')?.reason).toMatch(
        /^the posting names no technology we can compare with your stack \(.*no comparable main or must requirements/,
      );
    });

    it('a post role with an unknown stack goes to review', () => {
      const d = decide(
        {
          ...job(
            passingDoc((x) => {
              x.techStack.value = null;
            }),
          ),
          post: rolePost(),
        },
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual(stackReview);
    });

    it('an unknown stack with a sure location failure stays rejected', () => {
      const ukCtx: MatchContext = {
        ...ctx,
        places: {
          countriesOfRegion: new Map([['UK', new Set(['GB'])]]),
          countryOfCity: new Map(),
          countries: new Set(['GB', 'MA']),
        },
      };
      const p = exampleProfile();
      p.locations.remote = [{ kind: 'region', code: 'UK' }];
      p.eligibility = { ...p.eligibility, residenceCountry: 'MA' };
      const d = decide(
        job(
          passingDoc((x) => {
            x.techStack.value = null;
            x.openings = [
              {
                ...structuredClone(worldwide),
                places: [{ kind: 'country', code: 'GB' }],
                placeStrictness: 'label',
              },
            ];
          }),
        ),
        p,
        ukCtx,
      );
      expect(d.outcome).toBe('rejected');
      expect(d.review).toBeNull();
    });

    it('an unstated role with an unknown stack still fails on position', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.position.value = { roleKind: 'unstated', title: 'x' };
            x.techStack.value = null;
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('rejected');
      expect(d.checks.find((c) => c.rule === 'position')?.reason).toMatch(
        /neither the role nor the stack/,
      );
      expect(d.checks.find((c) => c.rule === 'stack')?.outcome).toBe('unknown');
    });
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
    expect(d.unverified).toBe(false);
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

  it('rejects a UK-only remote job for a Moroccan resident', () => {
    const ukCtx: MatchContext = {
      ...ctx,
      places: {
        countriesOfRegion: new Map([['UK', new Set(['GB'])]]),
        countryOfCity: new Map(),
        countries: new Set(['GB', 'MA']),
      },
    };
    const p = exampleProfile();
    p.locations.remote = [{ kind: 'region', code: 'UK' }];
    p.eligibility = { ...p.eligibility, residenceCountry: 'MA' };
    const d = decide(
      job(
        passingDoc((x) => {
          x.openings = [
            {
              ...structuredClone(worldwide),
              places: [{ kind: 'country', code: 'GB' }],
              placeStrictness: 'label',
            },
          ];
        }),
      ),
      p,
      ukCtx,
    );
    expect(d.outcome).toBe('rejected');
    expect(d.checks.find((c) => c.rule === 'location')).toMatchObject({
      outcome: 'fail',
      reason:
        'job location (remote in GB, stated in the description) requires living there; you live in MA',
    });
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

    it('a sure contract, language or authorization fail rejects', () => {
      const edits: ((x: JobFactsDocument) => void)[] = [
        (x) => {
          x.contractType.value = 'internship';
        },
        (x) => {
          x.requiredLanguages.value = [
            { lang: 'de', level: 'working', quote: '' },
          ];
        },
        (x) => {
          x.workAuthorization.value = {
            requirements: [{ kind: 'citizenship', place: 'US' }],
            sponsorship: 'yes',
          };
        },
      ];
      for (const edit of edits)
        expect(
          decide(job(passingDoc(edit)), exampleProfile(), ctx).outcome,
        ).toBe('rejected');
    });

    it('an unsure work authorization fail is review on workAuthorization', () => {
      const d = decide(
        job(
          passingDoc((x) => {
            x.workAuthorization.value = {
              requirements: [{ kind: 'work-permit', place: 'US' }],
              sponsorship: 'unstated',
            };
            x.workAuthorization.confidence = 'unsure';
            x.contractType.value = 'internship';
            x.contractType.confidence = 'unsure';
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      // contractType comes first in rule order.
      expect(d.review).toEqual({ rule: 'contractType', field: 'contractType' });
      expect(d.checks.at(-1)).toMatchObject({
        rule: 'workAuthorization',
        outcome: 'fail',
        unsure: true,
        unsureField: 'workAuthorization',
      });
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

    const unsureNotSwe = (
      roleKind: string,
      edit?: (d: JobFactsDocument) => void,
    ) =>
      passingDoc((x) => {
        x.isSoftwareEngineeringRole.value = false;
        x.isSoftwareEngineeringRole.confidence = 'unsure';
        x.position.value = { roleKind, title: 'x' };
        edit?.(x);
      });

    it('unsure not-SWE with a sure other role is rejected', () => {
      const d = decide(
        job(unsureNotSwe('fullstack_engineer')),
        exampleProfile(),
        ctx,
      );
      expect(d.checks[0]).toMatchObject({ outcome: 'fail', unsure: false });
      expect(d.outcome).toBe('rejected');
    });

    it('unsure not-SWE, role unstated, stack unknown is rejected', () => {
      const d = decide(
        job(
          unsureNotSwe('unstated', (x) => {
            x.techStack.value = null;
          }),
        ),
        exampleProfile(),
        ctx,
      );
      expect(d.checks[0]).toMatchObject({ outcome: 'fail', unsure: false });
      expect(d.outcome).toBe('rejected');
    });

    it('unsure not-SWE, role unstated, with a passing stack goes to review', () => {
      const d = decide(job(unsureNotSwe('unstated')), exampleProfile(), ctx);
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual({
        rule: 'position',
        field: 'isSoftwareEngineeringRole',
      });
    });

    it("unsure not-SWE with the profile's role goes to review", () => {
      const d = decide(
        job(unsureNotSwe('backend_engineer')),
        exampleProfile(),
        ctx,
      );
      expect(d.outcome).toBe('review');
      expect(d.review).toEqual({
        rule: 'position',
        field: 'isSoftwareEngineeringRole',
      });
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

describe('decide for post roles', () => {
  const rules = [
    'position',
    'seniority',
    'location',
    'stack',
    'salary',
    'currency',
    'contractType',
    'languages',
    'postingLanguage',
    'workAuthorization',
  ];

  it('a listing keeps ten checks', () => {
    const d = decide(job(passingDoc()), exampleProfile(), ctx);
    expect(d.checks).toHaveLength(10);
  });

  it('a role has thirteen, in order', () => {
    const d = decide(roleJob(), exampleProfile(), ctx);
    expect(d.checks.map((c) => c.rule)).toEqual([
      ...rules,
      'hiringVerdict',
      'blockedAuthor',
      'postAge',
    ]);
    expect(d.outcome).toBe('qualified');
  });

  it('an unsure verdict on an otherwise qualified role is review on hiringVerdict/verdict', () => {
    const d = decide(
      roleJob({ verdictConfidence: 'unsure' }),
      exampleProfile(),
      ctx,
    );
    expect(d.outcome).toBe('review');
    expect(d.review).toEqual({ rule: 'hiringVerdict', field: 'verdict' });
  });

  it('a blocked author rejects an otherwise qualified role', () => {
    const profile = { ...exampleProfile(), blockedAuthors: ['profile:a'] };
    const d = decide(
      roleJob({ authors: [{ key: 'profile:a', name: 'Ann' }] }),
      profile,
      ctx,
    );
    expect(d.outcome).toBe('rejected');
  });

  it('an old original rejects', () => {
    const d = decide(roleJob({ ageDays: 45 }), exampleProfile(), ctx);
    expect(d.outcome).toBe('rejected');
    expect(d.checks.at(-1)).toMatchObject({
      rule: 'postAge',
      reason: 'posted 45 days ago',
    });
  });

  it('an unknown post age leaves the role qualified, and not unverified', () => {
    const d = decide(roleJob({ ageDays: null }), exampleProfile(), ctx);
    expect(d.outcome).toBe('qualified');
    expect(d.unverified).toBe(false);
  });
});
