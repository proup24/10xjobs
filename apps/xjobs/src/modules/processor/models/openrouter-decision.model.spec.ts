import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransientModelError } from './errors';
import { OpenRouterClient } from './openrouter.client';
import { OpenRouterDecisionModel } from './openrouter-decision.model';
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
  afterEach(() => vi.unstubAllGlobals());

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
});
