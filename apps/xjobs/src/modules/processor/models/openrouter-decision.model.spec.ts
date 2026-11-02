import type { DecisionsResponse } from '@openrouter/sdk/models';
import type { CreateApiAlphaDecisionsRequest } from '@openrouter/sdk/models/operations';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import {
  ModelOutputError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
import { OpenRouterDecisionModel } from './openrouter-decision.model';
import type { OpenRouterClient } from './openrouter.client';
import { ModelPricing } from './pricing';
import type { DecisionQuestion, PostingInput } from './types';

const MODEL = 'typesafe/jev-1.14';

const input: PostingInput = {
  jobId: 'j1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: 'Remote in the EU. TypeScript and PostgreSQL.',
  truncated: false,
  evidence: {
    location: 'Paris, France',
    contractType: 'Full-time',
    experienceLevel: 'Mid-Senior level',
    salary: null,
  },
};

const questions: DecisionQuestion[] = [
  {
    key: 'seniority',
    kind: 'choice',
    options: ['junior', 'mid', 'senior', 'unstated'],
    instructions: 'The seniority the posting asks for.',
  },
  {
    key: 'isSoftwareEngineeringRole',
    kind: 'yesno',
    instructions: 'Is this a software engineering role?',
  },
];

function response(over: Partial<DecisionsResponse> = {}): DecisionsResponse {
  return {
    id: 'dec-1',
    model: MODEL,
    answers: {
      seniority: {
        type: 'choice',
        choice: 'senior',
        confidence: 0.91,
        probabilities: {
          junior: 0.01,
          mid: 0.06,
          senior: 0.92,
          unstated: 0.01,
        },
      },
      isSoftwareEngineeringRole: { type: 'noul', noul: 0.97 },
    },
    usage: { cost: 0.00002, inputTokens: 480, outputTokens: 0 },
    ...over,
  };
}

function client(result: DecisionsResponse | Error) {
  const create = vi.fn(async (_req: CreateApiAlphaDecisionsRequest) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    create,
    client: { alpha: { decisions: { create } } } as unknown as OpenRouterClient,
  };
}

function httpError(status: number) {
  return new OpenRouterError(`status ${status}`, {
    response: new Response('', { status }),
    request: new Request('https://openrouter.ai/api/alpha/decisions'),
    body: '',
  });
}

describe('OpenRouterDecisionModel', () => {
  it('sends one Decisions request with every question', async () => {
    const fake = client(response());
    await new OpenRouterDecisionModel(fake.client, MODEL).decide(
      input,
      questions,
    );

    const [req] = fake.create.mock.calls[0]!;
    expect(req.decisionsRequest.model).toBe(MODEL);
    expect(req.decisionsRequest.state).toContain('Senior Backend Engineer');
    expect(req.decisionsRequest.state).toContain('Remote in the EU');
    expect(req.decisionsRequest.state).toContain(
      'Listing metadata (context only):',
    );
    expect(req.decisionsRequest.questions.seniority).toEqual({
      type: 'choice',
      instructions: 'The seniority the posting asks for.',
      criteria: {
        junior: 'junior',
        mid: 'mid',
        senior: 'senior',
        unstated: 'unstated',
      },
    });
    expect(req.decisionsRequest.questions.isSoftwareEngineeringRole).toEqual({
      type: 'noul',
      instructions: 'Is this a software engineering role?',
      criteria: { true: 'Yes.', false: 'No.' },
    });
  });

  it('reads a choice with its confidence and a yes/no with |p − 0.5| × 2', async () => {
    const { answers, meta } = await new OpenRouterDecisionModel(
      client(response()).client,
      MODEL,
    ).decide(input, questions);

    expect(answers).toEqual([
      { key: 'seniority', value: 'senior', score: 0.91 },
      {
        key: 'isSoftwareEngineeringRole',
        value: true,
        score: expect.closeTo(0.94, 10),
      },
    ]);
    expect(meta).toMatchObject({
      model: MODEL,
      providerRequestId: 'dec-1',
      inputTokens: 480,
      outputTokens: 0,
      costUsd: 0.00002,
    });
  });

  it('uses the chosen option probability when no confidence is given', async () => {
    const res = response();
    res.answers.seniority = {
      type: 'choice',
      choice: 'mid',
      probabilities: { mid: 0.64 },
    };
    const { answers } = await new OpenRouterDecisionModel(
      client(res).client,
      MODEL,
    ).decide(input, questions);
    expect(answers[0]).toEqual({ key: 'seniority', value: 'mid', score: 0.64 });
  });

  it('reads "no" from a low yes probability', async () => {
    const res = response();
    res.answers.isSoftwareEngineeringRole = { type: 'noul', noul: 0.1 };
    const { answers } = await new OpenRouterDecisionModel(
      client(res).client,
      MODEL,
    ).decide(input, questions);
    expect(answers[1]).toEqual({
      key: 'isSoftwareEngineeringRole',
      value: false,
      score: expect.closeTo(0.8, 10),
    });
  });

  it('scores 0 an option that was never offered, a missing answer, or an answer of the wrong type', async () => {
    const res = response();
    res.answers.seniority = {
      type: 'choice',
      choice: 'guru',
      confidence: 0.99,
    };
    delete res.answers.isSoftwareEngineeringRole;
    const first = await new OpenRouterDecisionModel(
      client(res).client,
      MODEL,
    ).decide(input, questions);
    expect(first.answers).toEqual([
      { key: 'seniority', value: null, score: 0 },
      { key: 'isSoftwareEngineeringRole', value: null, score: 0 },
    ]);

    const swapped = response();
    swapped.answers.seniority = { type: 'noul', noul: 0.9 };
    const second = await new OpenRouterDecisionModel(
      client(swapped).client,
      MODEL,
    ).decide(input, questions);
    expect(second.answers[0]).toEqual({
      key: 'seniority',
      value: null,
      score: 0,
    });
  });

  it('throws an output error with the call cost when no question was answered', async () => {
    const error = await new OpenRouterDecisionModel(
      client(response({ answers: {} })).client,
      MODEL,
    )
      .decide(input, questions)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as ModelOutputError).meta?.costUsd).toBe(0.00002);
  });

  it('estimates a missing cost from the input tokens and the listed price', async () => {
    const pricing = new ModelPricing();
    pricing.set(new Map([[MODEL, { prompt: 0.00000004, completion: 0 }]]));
    const { meta } = await new OpenRouterDecisionModel(
      client(
        response({ usage: { inputTokens: 1000, outputTokens: 0 } }),
      ).client,
      MODEL,
      pricing,
    ).decide(input, questions);
    expect(meta.costUsd).toBeCloseTo(0.00004, 10);
  });

  it('maps provider failures', async () => {
    await expect(
      new OpenRouterDecisionModel(client(httpError(402)).client, MODEL).decide(
        input,
        questions,
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      new OpenRouterDecisionModel(client(httpError(503)).client, MODEL).decide(
        input,
        questions,
      ),
    ).rejects.toBeInstanceOf(TransientModelError);
  });
});
