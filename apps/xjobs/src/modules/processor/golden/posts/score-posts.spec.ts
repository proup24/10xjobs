import { Logger } from '@nestjs/common';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ProcessorConfig } from '../../config/processor.config';
import type { Vocabulary } from '../../repositories/vocab.repository';
import type { PostInput } from '../../rules/post-input';
import type { PostModelOutput, Verdict } from '../../schema/post-extraction';
import { AttemptLog } from '../../services/attempt-log';
import { FactAssembler } from '../../services/fact-assembler.service';
import { GenerationService } from '../../services/generation.service';
import type { AssembledPost } from '../../services/post-assembler.service';
import { PostAssembler } from '../../services/post-assembler.service';
import { PostPipeline } from '../../services/post-pipeline.service';
import {
  FakeExtractionModel,
  MemoryVocabRepository,
} from '../../testing/fakes';
import { DESCRIPTION, generatorOutput } from '../../testing/generator-output';
import type { PostGoldenCase, PostGoldenRole } from './golden-posts';
import { POST_BARS, scorePost, summarizePosts } from './score-posts';

const EXT = 'anthropic/claude-opus-5.5';
const config: ProcessorConfig = {
  extractionModel: EXT,
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 0,
  weeklyStopAt: 0.85,
  generationTries: 1,
  postDailyCap: 250,
};

const POST_TEXT = `We are hiring. Acme is hiring. Send your CV to jobs@acme.com or cv@acme.com. ${DESCRIPTION}`;
const post: PostInput = {
  input: {
    jobId: 'job-1',
    title: null,
    description: `${POST_TEXT}\n\nLinks in the post:\njobs@acme.com\ncv@acme.com`,
    truncated: false,
  },
  postText: POST_TEXT,
  links: {
    emails: ['jobs@acme.com', 'cv@acme.com'],
    linkedinJobIds: [],
    urls: [],
  },
};

type Role = PostModelOutput['roles'][number];

function role(title: string, email: string | null): Role {
  const base = generatorOutput() as unknown as Role;
  return {
    ...base,
    position: {
      value: { roleKind: 'backend_engineer', title },
      quote: 'Senior Backend Engineer',
      confidence: 'sure',
    },
    employer: { name: 'Acme', quote: 'Acme is hiring' },
    authorRelation: 'employer',
    howToApply: email
      ? {
          kinds: ['email'],
          email,
          emailQuote: `Send your CV to ${email}`.replace(
            'to cv@acme.com',
            'to jobs@acme.com or cv@acme.com',
          ),
          links: [],
          quote: 'Send your CV',
        }
      : {
          kinds: ['unstated'],
          email: null,
          emailQuote: '',
          links: [],
          quote: '',
        },
  } as Role;
}

let vocabulary: Vocabulary;

/** A real assembled post, through the pipeline with a fake generator. */
async function assembled(
  value: Verdict,
  confidence: 'sure' | 'unsure',
  roles: Role[] = [],
): Promise<AssembledPost> {
  const output: PostModelOutput = {
    verdict: {
      value,
      reason:
        value === 'hiring'
          ? 'hiring'
          : value === 'junk'
            ? 'funnel'
            : 'advice_or_commentary',
      quote: 'We are hiring',
      confidence,
    },
    roles,
  };
  const model = new FakeExtractionModel(() => output, EXT);
  return new PostPipeline(
    new GenerationService(model, new FactAssembler(), config),
    new PostAssembler(new FactAssembler()),
  ).run(post, vocabulary, new AttemptLog('job-1', { docType: 'post' }));
}

function labelRole(
  title: string,
  contactEmail: string | null,
  patch: Partial<PostGoldenRole> = {},
): PostGoldenRole {
  return {
    title,
    employer: 'Acme',
    applyKinds: contactEmail ? ['email'] : ['unstated'],
    contactEmail,
    facts: {},
    reviewed: true,
    ...patch,
  };
}

function goldenCase(
  value: Verdict,
  roles: PostGoldenRole[] = [],
  reviewed = true,
): PostGoldenCase {
  return {
    rawItemId: `raw-${value}`,
    sources: [],
    verdict: { value, reason: value, reviewed },
    roles,
    note: null,
  };
}

/** Enough reviewed cases that pass every bar, to change one at a time. */
async function passingSet() {
  const hiring = await assembled('hiring', 'sure', [
    role('Backend Engineer', 'jobs@acme.com'),
  ]);
  const notHiring = await assembled('not_hiring', 'sure');
  return [
    scorePost(
      goldenCase('hiring', [labelRole('Backend Engineer', 'jobs@acme.com')]),
      hiring,
      { index: 0 },
    ),
    scorePost(goldenCase('not_hiring'), notHiring, { index: 1 }),
  ];
}

describe('the post eval', () => {
  beforeAll(async () => {
    vocabulary = await new MemoryVocabRepository().snapshot();
  });
  beforeEach(() => {
    for (const level of ['log', 'warn', 'debug'] as const)
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('holds the bars the spec sets', () => {
    expect(POST_BARS).toEqual({
      wrongSends: 0,
      contactEmailExact: 1,
      hiringKept: 0.95,
    });
  });

  it('passes a reviewed set where every bar holds', async () => {
    const report = summarizePosts(await passingSet());

    expect(report.bars.wrongSends).toMatchObject({ value: 0, pass: true });
    expect(report.bars.contactEmailExact).toMatchObject({
      value: 1,
      pass: true,
    });
    expect(report.bars.hiringKept).toMatchObject({ value: 1, pass: true });
    expect(report.pass).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('fails wrongSends on a junk case that comes out sure hiring with an email', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(goldenCase('junk'), got, { index: 7 }),
    ]);

    expect(report.bars.wrongSends).toMatchObject({ value: 1, pass: false });
    expect(report.pass).toBe(false);
    expect(report.failures).toContainEqual({
      index: 7,
      bar: 'wrongSends',
      reason: 'labelled junk, came out hiring (sure) with jobs@acme.com',
    });
  });

  it('does not count an unsure hiring result on a junk case as a wrong send, but counts it by label', async () => {
    const got = await assembled('hiring', 'unsure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(goldenCase('junk'), got, { index: 7 }),
    ]);

    expect(report.bars.wrongSends).toMatchObject({ value: 0, pass: true });
    expect(report.unsureByLabel).toEqual({
      hiring: 0,
      not_hiring: 0,
      junk: 1,
    });
    expect(report.confusion.junk.hiring).toEqual({ sure: 0, unsure: 1 });
    expect(report.pass).toBe(true);
  });

  it('does not keep a hiring case that comes out unsure', async () => {
    const got = await assembled('hiring', 'unsure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const score = scorePost(
      goldenCase('hiring', [labelRole('Backend Engineer', 'jobs@acme.com')]),
      got,
      { index: 3 },
    );
    const report = summarizePosts([score]);

    expect(score.sureHiring).toBe(false);
    expect(report.bars.hiringKept).toMatchObject({ value: 0, pass: false });
    expect(report.failures).toContainEqual({
      index: 3,
      bar: 'hiringKept',
      reason: 'labelled hiring, came out hiring (unsure)',
    });
  });

  it('counts a failed generation as not kept, and as a miss on its labelled email', () => {
    const score = scorePost(
      goldenCase('hiring', [labelRole('Backend Engineer', 'jobs@acme.com')]),
      { failed: ['verdict.quote: not found in the post'] },
      { index: 4 },
    );
    const report = summarizePosts([score]);

    expect(report.bars.hiringKept).toMatchObject({ value: 0, pass: false });
    expect(report.bars.contactEmailExact).toMatchObject({
      value: 0,
      pass: false,
    });
    expect(report.confusion.hiring.failed).toBe(1);
    expect(report.failures).toContainEqual({
      index: 4,
      bar: 'generation',
      reason: 'failed: verdict.quote: not found in the post',
    });
  });

  it('fails contactEmailExact on an email extracted where none is labelled', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(
        goldenCase('hiring', [labelRole('Backend Engineer', null)]),
        got,
        {
          index: 5,
        },
      ),
    ]);

    expect(report.bars.contactEmailExact).toMatchObject({
      value: 0.5,
      pass: false,
    });
    expect(report.failures).toContainEqual({
      index: 5,
      bar: 'contactEmailExact',
      reason: 'role backend-engineer: want no email, got jobs@acme.com',
    });
  });

  it('pairs roles by role key order and counts a missing or extra role email as a miss', async () => {
    // Extracted in the other order; the keys sort them back into pairs.
    const got = await assembled('hiring', 'sure', [
      role('Frontend Engineer', 'cv@acme.com'),
      role('Backend Engineer', 'jobs@acme.com'),
      role('QA Engineer', 'jobs@acme.com'),
    ]);
    const score = scorePost(
      goldenCase('hiring', [
        labelRole('Backend Engineer', 'jobs@acme.com'),
        labelRole('Frontend Engineer', 'cv@acme.com'),
      ]),
      got,
      { index: 6 },
    );

    expect(score.emails).toEqual([
      {
        roleKey: 'backend-engineer',
        want: 'jobs@acme.com',
        got: 'jobs@acme.com',
      },
      { roleKey: 'frontend-engineer', want: 'cv@acme.com', got: 'cv@acme.com' },
      { roleKey: 'qa-engineer', want: null, got: 'jobs@acme.com' },
    ]);
    expect(score.emailExact).toBe(false);
  });

  it('pairs a role whose key differs slightly with its closest label, not by shifted order', async () => {
    // Sorted by key, "recruitment-consultant" would fall after "crm-manager"
    // and shift every pair by one.
    const got = await assembled('hiring', 'sure', [
      role('CRM Manager', 'jobs@acme.com'),
      role('Recruitment Consultant', 'cv@acme.com'),
    ]);
    const score = scorePost(
      goldenCase('hiring', [
        labelRole('180 Recruitment Consultant', 'cv@acme.com'),
        labelRole('CRM Manager', 'jobs@acme.com'),
      ]),
      got,
      { index: 7 },
    );

    expect(score.emails).toEqual([
      {
        roleKey: '180-recruitment-consultant',
        want: 'cv@acme.com',
        got: 'cv@acme.com',
      },
      { roleKey: 'crm-manager', want: 'jobs@acme.com', got: 'jobs@acme.com' },
    ]);
    expect(score.emailExact).toBe(true);
    expect(score.keyMismatches).toEqual([
      { want: '180-recruitment-consultant', got: 'recruitment-consultant' },
    ]);
  });

  it('fails every bar while a verdict label is unreviewed, naming the case', async () => {
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(
        goldenCase('not_hiring', [], false),
        await assembled('not_hiring', 'sure'),
        {
          index: 9,
        },
      ),
    ]);

    for (const bar of [
      'wrongSends',
      'contactEmailExact',
      'hiringKept',
    ] as const) {
      expect(report.bars[bar].pass).toBe(false);
      expect(report.bars[bar].blockedBy).toEqual([9]);
    }
    expect(report.roleFacts.blockedBy).toEqual([9]);
    expect(report.pass).toBe(false);
  });

  it('blocks the email and role fact bars on a hiring case with no reviewed roles', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(goldenCase('hiring', []), got, { index: 2 }),
    ]);

    expect(report.bars.contactEmailExact.blockedBy).toEqual([2]);
    expect(report.bars.contactEmailExact.pass).toBe(false);
    expect(report.roleFacts.blockedBy).toEqual([2]);
    expect(report.bars.wrongSends.pass).toBe(true);
    expect(report.bars.hiringKept.pass).toBe(true);
  });

  it('scores labelled role facts with the listing fact scorer', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Backend Engineer', 'jobs@acme.com'),
    ]);
    const score = scorePost(
      goldenCase('hiring', [
        labelRole('Backend Engineer', 'jobs@acme.com', {
          facts: { arrangement: 'onsite', seniority: 'senior' },
        }),
      ]),
      got,
      { index: 0 },
    );
    const report = summarizePosts([score]);

    expect(score.roleFacts).toHaveLength(1);
    expect(score.roleFacts[0].facts.arrangement).toMatchObject({
      correct: 0,
      want: 'onsite',
      got: 'remote',
    });
    expect(score.roleFacts[0].facts.seniority).toMatchObject({ correct: 1 });
    expect(report.roleFacts.facts.arrangement).toEqual({
      scored: 1,
      accuracy: 0,
    });
    expect(report.roleFacts.bars.arrangement).toBe(false);
    expect(report.pass).toBe(false);
  });

  it('fails the report when a not-hiring case never generates', () => {
    const report = summarizePosts([
      scorePost(
        goldenCase('not_hiring'),
        { failed: ['no document'] },
        { index: 8 },
      ),
    ]);

    expect(report.bars.wrongSends).toMatchObject({
      value: 0,
      blockedBy: [8],
      pass: false,
    });
    expect(report.pass).toBe(false);
  });

  it('fails wrongSends on one failed junk case among passing ones', async () => {
    const report = summarizePosts([
      ...(await passingSet()),
      scorePost(goldenCase('junk'), { failed: ['no document'] }, { index: 7 }),
    ]);

    expect(report.bars.wrongSends.pass).toBe(false);
    expect(report.bars.wrongSends.blockedBy).toEqual([7]);
    expect(report.bars.hiringKept.pass).toBe(true);
    expect(report.pass).toBe(false);
  });

  it('warns when a paired role has another key, still scoring its facts', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Frontend Engineer', 'jobs@acme.com'),
    ]);
    const score = scorePost(
      goldenCase('hiring', [
        labelRole('Backend Engineer', 'jobs@acme.com', {
          facts: { seniority: 'senior' },
        }),
      ]),
      got,
      { index: 3 },
    );
    const report = summarizePosts([score]);

    expect(score.emailExact).toBe(true);
    expect(score.roleFacts).toHaveLength(1);
    expect(report.bars.contactEmailExact.pass).toBe(true);
    expect(report.failures).toContainEqual({
      index: 3,
      bar: 'roleKey',
      reason:
        'warning: labelled role backend-engineer paired with extracted frontend-engineer',
    });
  });

  it('counts a missing role on a reviewed hiring case as an email miss', async () => {
    const got = await assembled('hiring', 'sure', [
      role('Backend Engineer', null),
    ]);
    const score = scorePost(
      goldenCase('hiring', [
        labelRole('Backend Engineer', null),
        labelRole('Frontend Engineer', null),
      ]),
      got,
      { index: 4 },
    );
    const report = summarizePosts([score]);

    expect(score.emailExact).toBe(false);
    expect(report.bars.contactEmailExact).toMatchObject({
      value: 0,
      scored: 1,
      pass: false,
    });
    expect(report.failures).toContainEqual({
      index: 4,
      bar: 'contactEmailExact',
      reason: '2 roles labelled, 1 extracted',
    });
    expect(report.pass).toBe(false);
  });

  it('reports calls and cost per post', async () => {
    const [a, b] = await passingSet();
    const report = summarizePosts([
      { ...a, generatorCalls: 1, costUsd: 0.02 },
      { ...b, generatorCalls: 3, costUsd: 0.04 },
    ]);

    expect(report.generatorCallsPerPost).toBe(2);
    expect(report.costPerPost).toBeCloseTo(0.03);
  });

  describe('owner-reviewed bars', () => {
    const agreed = (c: PostGoldenCase): PostGoldenCase => ({
      ...c,
      verdict: { ...c.verdict, reviewedBy: 'agreement' },
      roles: c.roles.map((r) => ({ ...r, reviewedBy: 'agreement' })),
    });

    it('counts a label reviewed by agreement for the bars, but not as owner-reviewed', async () => {
      const hiring = await assembled('hiring', 'sure', [
        role('Backend Engineer', 'jobs@acme.com'),
      ]);
      const score = scorePost(
        agreed(
          goldenCase('hiring', [
            labelRole('Backend Engineer', 'jobs@acme.com'),
          ]),
        ),
        hiring,
        { index: 0 },
      );
      const report = summarizePosts([score]);

      expect(score.verdictReviewed).toBe(true);
      expect(score.rolesReviewed).toBe(true);
      expect(score.ownerReviewed).toBe(false);
      expect(report.pass).toBe(true);
      expect(report.ownerCases).toBe(0);
      expect(report.ownerBars.hiringKept).toMatchObject({
        scored: 0,
        value: null,
        pass: false,
      });
    });

    it('treats an absent reviewedBy as the owner', async () => {
      const report = summarizePosts(await passingSet());

      expect(report.ownerCases).toBe(2);
      expect(report.ownerBars.hiringKept).toMatchObject({
        value: 1,
        pass: true,
      });
    });

    it('needs the owner on every role of a hiring case', async () => {
      const got = await assembled('hiring', 'sure', [
        role('Backend Engineer', 'jobs@acme.com'),
        role('Data Engineer', 'jobs@acme.com'),
      ]);
      const score = scorePost(
        goldenCase('hiring', [
          labelRole('Backend Engineer', 'jobs@acme.com', {
            reviewedBy: 'owner',
          }),
          labelRole('Data Engineer', 'jobs@acme.com', {
            reviewedBy: 'agreement',
          }),
        ]),
        got,
        { index: 1 },
      );

      expect(score.rolesReviewed).toBe(true);
      expect(score.ownerReviewed).toBe(false);
    });

    it('scores the bars on owner-reviewed cases alone, so an agreement-case miss does not show there', async () => {
      const wrongEmail = await assembled('hiring', 'sure', [
        role('Backend Engineer', 'cv@acme.com'),
      ]);
      const missed = scorePost(
        agreed(
          goldenCase('hiring', [
            labelRole('Backend Engineer', 'jobs@acme.com'),
          ]),
        ),
        wrongEmail,
        { index: 5 },
      );
      const report = summarizePosts([...(await passingSet()), missed]);

      expect(report.bars.contactEmailExact).toMatchObject({
        scored: 2,
        pass: false,
      });
      expect(report.ownerCases).toBe(2);
      expect(report.ownerBars.contactEmailExact).toMatchObject({
        value: 1,
        scored: 1,
        pass: true,
      });
      expect(report.ownerBars.wrongSends).toMatchObject({
        scored: 1,
        pass: true,
      });
    });

    it('leaves an unreviewed case out of the owner bars', async () => {
      const got = await assembled('not_hiring', 'sure');
      const report = summarizePosts([
        scorePost(goldenCase('not_hiring', [], false), got, { index: 9 }),
      ]);

      expect(report.ownerCases).toBe(0);
      expect(report.ownerBars.wrongSends.scored).toBe(0);
    });
  });
});
