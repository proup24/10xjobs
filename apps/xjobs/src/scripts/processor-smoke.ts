/**
 * Live smoke check of the processor's OpenRouter wiring, through the real
 * adapters and the configured models:
 *
 *   pnpm --filter @xjobs/xjobs processor:smoke
 *
 * Runs the worker's startup checks (key, extraction model listing, structured
 * outputs, pricing), then one Decisions call and one structured generation
 * (through the AI SDK) on
 * a sample posting, and prints the answers, the output and each call's cost.
 * Costs a few cents. Needs `OPENROUTER_API_KEY`; reads the PROCESSOR_* models.
 */
import { loadEnvironmentFiles } from '@xjobs/database/env';
import { OpenRouterDecisionModel } from 'src/modules/processor/models/decision.model';
import { AiSdkExtractionModel } from 'src/modules/processor/models/extraction.model';
import {
  assertApiKey,
  checkModels,
  createOpenRouterClient,
} from 'src/modules/processor/models/client';
import { ModelPricing } from 'src/modules/processor/models/pricing';
import type { PostingInput } from 'src/modules/processor/models/types';
import { buildVerificationQuestions } from 'src/modules/processor/rules/questions';
import { systemPrompt } from 'src/modules/processor/prompts/prompt';
import { modelOutputSchema } from 'src/modules/processor/schema';
import { SEED } from 'src/modules/processor/vocab/seed-data';
import { LIST_NAMES } from 'src/modules/processor/vocab/lists';

const POSTING: PostingInput = {
  jobId: 'smoke',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: [
    'We are hiring a Senior Backend Engineer, remote within the EU.',
    'You will build NestJS and PostgreSQL services for our payments platform.',
    '5+ years of experience with TypeScript required.',
    'Open to candidates in Germany, France and Spain. Full-time, permanent.',
  ].join('\n\n'),
  truncated: false,
  evidence: {
    location: 'Berlin, Germany',
    contractType: 'Full-time',
    experienceLevel: 'Mid-Senior level',
    salary: null,
  },
};

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const config = {
    decisionModel: process.env.PROCESSOR_DECISION_MODEL ?? 'typesafe/jev-1.14',
    extractionModel:
      process.env.PROCESSOR_EXTRACTION_MODEL ?? 'anthropic/claude-opus-5.5',
  };
  const client = createOpenRouterClient(apiKey);

  await assertApiKey(client);
  const prices = await checkModels(client, config);
  const pricing = new ModelPricing();
  pricing.set(prices);
  console.log(
    `startup checks passed; priced: ${[...prices.keys()].join(', ')}`,
  );

  const options = Object.fromEntries(
    LIST_NAMES.map((list) => [list, SEED[list].map((t) => t.code)]),
  ) as Parameters<typeof buildVerificationQuestions>[0];
  const questions = buildVerificationQuestions(options);

  const decision = await new OpenRouterDecisionModel(
    client,
    config.decisionModel,
    pricing,
  ).decide(POSTING, questions);
  console.log(
    `\n${config.decisionModel}: $${decision.meta.costUsd.toFixed(6)}`,
  );
  for (const a of decision.answers)
    console.log(
      `  ${a.key} = ${String(a.value)} (score ${a.score.toFixed(2)})`,
    );

  const extraction = await new AiSdkExtractionModel(
    apiKey,
    config.extractionModel,
    pricing,
  ).generate(POSTING, {
    systemPrompt: systemPrompt(),
    schema: modelOutputSchema(options),
  });
  console.log(
    `\n${config.extractionModel}: $${extraction.meta.costUsd.toFixed(6)}, ${extraction.meta.inputTokens} in (${extraction.meta.cachedInputTokens} cached), ${extraction.meta.outputTokens} out`,
  );
  console.log(JSON.stringify(extraction.output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
