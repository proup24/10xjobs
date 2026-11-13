/**
 * Live smoke check of the processor's `claude -p` wiring, through the real
 * runner and the configured model:
 *
 *   pnpm --filter @xjobs/xjobs processor:smoke
 *
 * Runs the worker's startup checks (`claude --version` at the pinned
 * version, one tiny call with the credential), then one real extraction of a
 * sample posting, and prints the output and its usage. Uses the Claude
 * subscription (or API key); needs `CLAUDE_CODE_OAUTH_TOKEN` or
 * `ANTHROPIC_API_KEY`, and reads the PROCESSOR_* settings.
 */
import { loadEnvironmentFiles } from '@xjobs/database/env';
import { processorEnvironmentSchema } from 'src/config/environment.validation';
import { createClaudeExtractionModel } from 'src/modules/processor/models/claude-extraction.model';
import {
  checkClaudeCall,
  checkClaudeInstalled,
  claudeBin,
  describeFailure,
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from 'src/modules/processor/models/claude/startup';
import type { PostingInput } from 'src/modules/processor/models/types';
import { systemPrompt } from 'src/modules/processor/prompts/prompt';
import {
  type ListOptions,
  modelOutputSchema,
} from 'src/modules/processor/schema';
import { SEED } from 'src/modules/processor/vocab/seed-data';
import { LIST_NAMES } from 'src/modules/processor/vocab/lists';

const POSTING: PostingInput = {
  jobId: 'smoke',
  title: 'Senior Backend Engineer',
  description: [
    'We are hiring a Senior Backend Engineer, remote within the EU.',
    'You will build NestJS and PostgreSQL services for our payments platform.',
    '5+ years of experience with TypeScript required.',
    'Open to candidates in Germany, France and Spain. Full-time, permanent.',
  ].join('\n\n'),
  truncated: false,
};

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const env = processorEnvironmentSchema.parse(process.env);
  if (!hasClaudeCredential(env)) throw new Error(NO_CLAUDE_CREDENTIAL);
  const bin = claudeBin(process.env);
  const model = createClaudeExtractionModel({
    model: env.PROCESSOR_EXTRACTION_MODEL,
    effort: env.PROCESSOR_EFFORT,
    timeoutMs: env.PROCESSOR_CALL_TIMEOUT_MS,
    bin,
    onLimits: (limits) => console.log(`limits: ${JSON.stringify(limits)}`),
  });

  await checkClaudeInstalled(bin);
  const failure = await checkClaudeCall(model);
  if (failure)
    throw new Error(`startup check failed: ${describeFailure(failure)}`);
  console.log('startup checks passed');

  const options = Object.fromEntries(
    LIST_NAMES.map((list) => [list, SEED[list].map((t) => t.code)]),
  ) as ListOptions;

  const extraction = await model.generate(POSTING, {
    systemPrompt: systemPrompt(),
    schema: modelOutputSchema(options),
  });
  const { meta } = extraction;
  console.log(
    `\n${meta.model}: ${meta.latencyMs} ms, ${meta.inputTokens} in (${meta.cachedInputTokens} cached), ${meta.outputTokens} out, $${meta.costUsd.toFixed(6)} list price`,
  );
  console.log(JSON.stringify(extraction.output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
