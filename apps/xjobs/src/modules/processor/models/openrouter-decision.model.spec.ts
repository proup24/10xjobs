import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from './errors';
import { OpenRouterClient } from './openrouter.client';
import { OpenRouterDecisionModel } from './openrouter-decision.model';
import { ModelPricing } from './pricing';
import type { DecisionQuestion, PostingInput } from './types';

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

const input: PostingInput = {
  jobId: 'j1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: 'Build NestJS services.',
  truncated: false,
  evidence: {
    location: null,
    contractType: null,
    experienceLevel: null,
    salary: null,
  },
};

const questions: DecisionQuestion[] = [
  {
    key: 'seniority',
    kind: 'choice',
    options: ['junior', 'mid', 'senior', 'unstated'],
    instructions: 'What seniority?',
  },
  {
    key: 'isSoftwareEngineeringRole',
    kind: 'yesno',
    instructions: 'Software role?',
  },
];

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const model = () =>
  new OpenRouterDecisionModel(new OpenRouterClient('key'), 'typesafe/jev-1.14');

describe('OpenRouterDecisionModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps answers and cost, and sends the pinned model', async () => {
    const fetchMock = stubFetch(fixture('decision-ok.json'));
    const { answers, meta } = await model().decide(input, questions);
    expect(answers).toEqual([
      { key: 'seniority', value: 'senior', score: 0.9 },
      { key: 'isSoftwareEngineeringRole', value: true, score: 0.95 },
    ]);
    expect(meta.costUsd).toBe(0.0021);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('typesafe/jev-1.14');
    expect(sent.questions.isSoftwareEngineeringRole.type).toBe('noul');
    expect(Object.keys(sent.questions.seniority.criteria)).toEqual(
      questions[0].kind === 'choice' ? questions[0].options : [],
    );
  });

  it('turns an option outside the question into a null answer', async () => {
    stubFetch(fixture('decision-bad-option.json'));
    const { answers } = await model().decide(input, questions);
    expect(answers[0]).toEqual({ key: 'seniority', value: null, score: 0 });
    expect(answers[1].value).toBe(false);
  });

  it('turns a missing answer into a null answer', async () => {
    stubFetch(
      JSON.stringify({
        answers: {
          seniority: { type: 'choice', selected: 'mid', confidence: 0.6 },
        },
        usage: { cost: 0.001 },
      }),
    );
    const { answers } = await model().decide(input, questions);
    expect(answers[1]).toEqual({
      key: 'isSoftwareEngineeringRole',
      value: null,
      score: 0,
    });
  });

  it('throws a transient error on 429', async () => {
    stubFetch(fixture('error-429.json'), 429);
    await expect(model().decide(input, questions)).rejects.toBeInstanceOf(
      TransientModelError,
    );
  });

  it.each([
    ['null', null],
    ['string', 'senior'],
  ])('treats a %s answer as missing', async (_name, bad) => {
    stubFetch(
      JSON.stringify({
        answers: {
          seniority: bad,
          isSoftwareEngineeringRole: { type: 'noul', probability: 0.5 },
        },
        usage: { cost: 0.001 },
      }),
    );
    const { answers } = await model().decide(input, questions);
    expect(answers.map((a) => [a.value, a.score])).toEqual([
      [null, 0],
      [true, 0],
    ]);
  });

  it('scores 0 when the option score is not a number', async () => {
    stubFetch(
      JSON.stringify({
        answers: {
          seniority: {
            type: 'choice',
            selected: 'mid',
            probabilities: { mid: 'high' },
            confidence: 'high',
          },
        },
      }),
    );
    const { answers } = await model().decide(input, questions);
    expect(answers[0]).toEqual({ key: 'seniority', value: 'mid', score: 0 });
  });

  it('throws a request error on a 200 with a 4xx error code', async () => {
    stubFetch('{"error":{"code":404,"message":"no model"}}');
    await expect(model().decide(input, questions)).rejects.toBeInstanceOf(
      ModelRequestError,
    );
  });

  it('throws provider-unavailable on a 200 with a 401 code', async () => {
    stubFetch('{"error":{"code":401,"message":"no key"}}');
    await expect(model().decide(input, questions)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('estimates a missing cost from the reported tokens and list prices', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const pricing = new ModelPricing();
    pricing.set(
      new Map([['typesafe/jev-1.14', { prompt: 0.000001, completion: 0 }]]),
    );
    const priced = new OpenRouterDecisionModel(
      new OpenRouterClient('key'),
      'typesafe/jev-1.14',
      pricing,
    );
    const body = (usage: unknown) =>
      JSON.stringify({
        answers: { seniority: { selected: 'mid', confidence: 0.9 } },
        usage,
      });
    stubFetch(body({ prompt_tokens: 2000 }));
    const { meta } = await priced.decide(input, questions);
    expect(meta.inputTokens).toBe(2000);
    expect(meta.costUsd).toBeCloseTo(0.002, 9);

    // No tokens either: about four characters of request per token.
    stubFetch(body({}));
    const again = await priced.decide(input, questions);
    expect(again.meta.costUsd).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
