import { describe, expect, it } from 'vitest';
import { ExtractionInvalidError } from '../models/errors';
import type { ModelCallMeta, PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import { roleKeys } from '../rules/role-key';
import { buildPostInput } from '../rules/post-input';
import { shareWithEmail } from '../rules/post-input.testing';
import { MemoryVocabRepository } from '../testing/fakes';
import { DESCRIPTION, generatorOutput } from '../testing/generator-output';
import type { PostModelOutput } from '../schema/post-extraction';
import { FactAssembler } from './fact-assembler.service';
import { PostAssembler } from './post-assembler.service';

const meta: ModelCallMeta = {
  model: 'm',
  providerRequestId: null,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costUsd: 0,
  latencyMs: 0,
};

const POST_TEXT = `We are hiring. Acme is hiring. Send your CV to Jobs@Acme.com. ${DESCRIPTION}`;
const input: PostingInput = {
  jobId: 'j',
  title: null,
  description: POST_TEXT,
  truncated: false,
};
const links = {
  emails: ['jobs@acme.com'],
  linkedinJobIds: ['4111111111'],
  urls: ['https://boards.greenhouse.io/acme/jobs/1'],
};

type Role = PostModelOutput['roles'][number];

function role(
  over: Partial<Role['howToApply']> = {},
  title = 'Backend Engineer',
): Role {
  const base = generatorOutput() as unknown as Role;
  return {
    ...base,
    position: {
      ...base.position,
      value: { roleKind: 'backend_engineer', title },
    },
    employer: { name: 'Acme', quote: 'Acme is hiring' },
    authorRelation: 'employer',
    howToApply: {
      kinds: ['email'],
      email: 'Jobs@Acme.com.',
      emailQuote: 'Send your CV to Jobs@Acme.com',
      links: [],
      quote: 'Send your CV to Jobs@Acme.com',
      ...over,
    },
  } as Role;
}

function output(...roles: Role[]): PostModelOutput {
  return {
    verdict: {
      value: 'hiring',
      reason: 'hiring',
      quote: 'We are hiring',
      confidence: 'sure',
    },
    roles,
  };
}

describe('PostAssembler', () => {
  const assembler = new PostAssembler(new FactAssembler());
  let vocabulary: Vocabulary;
  const run = async (o: PostModelOutput, i = input, l = links) => {
    vocabulary ??= await new MemoryVocabRepository().snapshot();
    return assembler.assemble(o, meta, i, l, vocabulary);
  };
  const invalidPath = async (o: PostModelOutput, i = input, l = links) => {
    const error = await run(o, i, l).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionInvalidError);
    return (error as ExtractionInvalidError).path;
  };

  it('accepts a noisy email and stores it as it is in links', async () => {
    const out = await run(output(role()));
    expect(out.doc.roles[0].howToApply.email).toBe('jobs@acme.com');
    expect(out.doc.roles[0].title).toBe('Backend Engineer');
    expect(out.roles).toHaveLength(1);
    expect(out.doc.models).toEqual({ generator: 'm' });
  });

  it('throws on an email that is not in the post links', async () => {
    const o = output(role({ email: 'press@acme.com' }));
    expect(await invalidPath(o)).toBe('roles.0.howToApply.email');
  });

  it('throws when the email quote is not in the text', async () => {
    const o = output(role({ emailQuote: 'Write to jobs@acme.com today' }));
    expect(await invalidPath(o)).toBe('roles.0.howToApply.emailQuote');
  });

  it('throws when the email quote does not contain the email', async () => {
    const o = output(role({ emailQuote: 'We are hiring' }));
    expect(await invalidPath(o)).toBe('roles.0.howToApply.emailQuote');
  });

  it('throws on a link that is not in the post links', async () => {
    const o = output(role({ links: ['https://acme.com/careers'] }));
    expect(await invalidPath(o)).toBe('roles.0.howToApply.links.0');
  });

  it('accepts listed links and a LinkedIn job url with a listed id', async () => {
    const o = output(
      role({
        links: [
          'https://boards.greenhouse.io/acme/jobs/1',
          'https://www.linkedin.com/jobs/view/4111111111',
        ],
      }),
    );
    const out = await run(o);
    expect(out.doc.roles[0].howToApply.links).toHaveLength(2);
    const bad = output(
      role({ links: ['https://www.linkedin.com/jobs/view/999'] }),
    );
    expect(await invalidPath(bad)).toBe('roles.0.howToApply.links.0');
  });

  it('does not accept a trailing-slash difference', async () => {
    const o = output(
      role({ links: ['https://boards.greenhouse.io/acme/jobs/1/'] }),
    );
    expect(await invalidPath(o)).toBe('roles.0.howToApply.links.0');
  });

  it('throws when the verdict quote is not in the text', async () => {
    const o = output(role());
    o.verdict.quote = 'We are not in the post';
    expect(await invalidPath(o)).toBe('verdict.quote');
  });

  it('assembles a junk output with no roles', async () => {
    const out = await run({
      verdict: {
        value: 'junk',
        reason: 'funnel',
        quote: 'We are hiring',
        confidence: 'sure',
      },
      roles: [],
    });
    expect(out.doc.roles).toEqual([]);
    expect(out.roles).toEqual([]);
    expect(out.quoteFailures).toBe(0);
  });

  it('accepts an email found only in a sharer added text', async () => {
    const job = {
      id: 'j',
      closed: false,
      title: null,
      descriptionText: null,
      kind: 'post' as const,
      postSources: [shareWithEmail],
    };
    const built = buildPostInput(job);
    const o = output(
      role({
        email: 'jobs@acme.com',
        emailQuote: 'DM me or email jobs@acme.com',
        quote: 'DM me or email jobs@acme.com',
      }),
    );
    o.verdict.quote = 'Acme is hiring';
    o.roles[0].employer.quote = 'Acme is hiring';
    const out = await run(o, built.input, built.links);
    expect(out.doc.roles[0].howToApply.email).toBe('jobs@acme.com');
  });

  it('keys roles by roleKeys of their titles, in order', async () => {
    const out = await run(
      output(role({}, 'Backend Engineer'), role({}, 'Backend Engineer')),
    );
    expect(out.doc.roles.map((r) => r.roleKey)).toEqual(
      roleKeys(['Backend Engineer', 'Backend Engineer']),
    );
    expect(out.roles).toHaveLength(2);
  });

  it('counts and clears a role quote that is not in the text', async () => {
    const o = output(role({ quote: 'Apply via carrier pigeon' }));
    const out = await run(o);
    expect(out.doc.roles[0].howToApply.quote).toBe('');
    expect(out.quoteFailures).toBeGreaterThanOrEqual(1);
  });
});
