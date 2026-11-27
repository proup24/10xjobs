/**
 * Drafts the golden labels career-hub lacks (arrangement, contract type,
 * software-engineering role) with the extraction model:
 *
 *   pnpm --filter @xjobs/xjobs processor:golden-draft
 *
 * Calls `claude -p` (the Claude subscription). For each case missing a `drafted` key it writes all three
 * values with `reviewed: false`. A human then reads every one and sets
 * `reviewed: true` (or corrects the value); the eval ignores the rest.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvironmentFiles } from '@xjobs/database/env';
import {
  type LabelKey,
  GOLDEN_CASES_DIR,
  loadGolden,
} from 'src/modules/processor/golden/golden';
import { z } from 'zod';
import { processorEnvironmentSchema } from 'src/config/environment.validation';
import { createClaudeExtractionModel } from 'src/modules/processor/models/claude-extraction.model';
import {
  claudeBin,
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from 'src/modules/processor/models/claude/startup';
import { UsageLimitError } from 'src/modules/processor/models/errors';
import type { PostingInput } from 'src/modules/processor/models/types';
import { ProcessorGuard } from 'src/modules/processor/services/processor-guard.service';
import { MemoryProcessorRepository } from 'src/modules/processor/testing/fakes';
import { SEED } from 'src/modules/processor/vocab/seed-data';

const KEYS: LabelKey[] = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
];

const codes = (list: keyof typeof SEED) => SEED[list].map((t) => t.code);

const SYSTEM_PROMPT = [
  'You label job postings for a test set. Answer from the posting text only.',
  '- arrangement: where the work is done (remote, hybrid or onsite), or unstated.',
  '- contractType: the contract type offered, or unstated.',
  '- isSoftwareEngineeringRole: true when the job is mainly building or running software.',
  'Use "unstated" whenever the posting does not say. Never guess.',
].join('\n');

const codeEnum = (list: keyof typeof SEED) =>
  z.enum(codes(list) as [string, ...string[]]);

const SCHEMA = z.strictObject({
  arrangement: codeEnum('arrangements'),
  contractType: codeEnum('contractTypes'),
  isSoftwareEngineeringRole: z.boolean(),
});

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const env = processorEnvironmentSchema.parse(process.env);
  if (!hasClaudeCredential(env)) throw new Error(NO_CLAUDE_CREDENTIAL);
  const model = env.PROCESSOR_EXTRACTION_MODEL;
  // The worker's guard rules: stop at the weekly reserve or a usage limit.
  const guard = new ProcessorGuard(new MemoryProcessorRepository(), {
    extractionModel: model,
    concurrency: 1,
    maxAttempts: 1,
    claimTimeoutMs: env.PROCESSOR_CLAIM_TIMEOUT_MS,
    dailyBudgetUsd: 0,
    weeklyStopAt: env.PROCESSOR_WEEKLY_STOP_AT,
    generationTries: 1,
    postDailyCap: env.POST_EXTRACTION_DAILY_CAP,
  });
  const extraction = createClaudeExtractionModel({
    model,
    effort: env.PROCESSOR_EFFORT,
    timeoutMs: env.PROCESSOR_CALL_TIMEOUT_MS,
    bin: claudeBin(process.env),
    onLimits: (limits) => guard.observeLimits(limits),
  });
  const todo = loadGolden().filter((c) => KEYS.some((k) => !c.drafted[k]));
  console.log(`drafting ${todo.length} cases with ${model}`);
  let cost = 0;
  for (const c of todo) {
    const pause = guard.pauseState();
    if (pause) {
      console.log(
        `STOPPED ON A LIMIT (${pause.reason}, until ${pause.until.toISOString()}): ${pause.detail}. Drafted cases are saved; re-run after the reset.`,
      );
      break;
    }
    const input: PostingInput = {
      jobId: c.id,
      ...c.input,
      truncated: false,
    };
    let result: Awaited<ReturnType<typeof extraction.generate>>;
    try {
      result = await extraction.generate(input, {
        systemPrompt: SYSTEM_PROMPT,
        schema: SCHEMA,
      });
    } catch (error) {
      if (!(error instanceof UsageLimitError)) throw error;
      guard.pauseForUsageLimit(error.limit?.resetsAt ?? null, error.message);
      continue;
    }
    const { output, meta } = result;
    cost += meta.costUsd;
    const answer = output as Record<LabelKey, unknown>;
    for (const key of KEYS)
      c.drafted[key] = { value: answer[key], reviewed: false };
    const file = readdirSync(GOLDEN_CASES_DIR).find(
      (f) => f === `${c.id}.json`,
    );
    if (!file) throw new Error(`no file for case ${c.id}`);
    writeFileSync(
      join(GOLDEN_CASES_DIR, file),
      `${JSON.stringify(c, null, 2)}\n`,
    );
    console.log(`  ${c.id}: ${KEYS.map((k) => String(answer[k])).join(' | ')}`);
  }
  console.log(`done, cost ${cost.toFixed(4)} USD. Review every value.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
