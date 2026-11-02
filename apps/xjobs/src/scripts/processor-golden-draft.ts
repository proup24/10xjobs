/**
 * Drafts the golden labels career-hub lacks (arrangement, contract type,
 * software-engineering role, engagement) with the extraction model:
 *
 *   pnpm --filter @xjobs/xjobs processor:golden-draft
 *
 * Calls a paid API. For each case missing a `drafted` key it writes all four
 * values with `reviewed: false`. A human then reads every one and sets
 * `reviewed: true` (or corrects the value); the eval ignores the rest.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvironmentFiles } from 'src/config/environment.loader';
import {
  type DraftedKey,
  GOLDEN_CASES_DIR,
  loadGolden,
} from 'src/modules/processor/golden/golden';
import { OpenRouterExtractionModel } from 'src/modules/processor/models/extraction.model';
import { createOpenRouterClient } from 'src/modules/processor/models/client';
import type { PostingInput } from 'src/modules/processor/models/types';
import { SEED } from 'src/modules/processor/vocab/seed-data';

const KEYS: DraftedKey[] = [
  'arrangement',
  'contractType',
  'isSoftwareEngineeringRole',
  'engagement',
];

const codes = (list: keyof typeof SEED) => SEED[list].map((t) => t.code);

const SYSTEM_PROMPT = [
  'You label job postings for a test set. Answer from the posting text only.',
  '- arrangement: where the work is done (remote, hybrid or onsite), or unstated.',
  '- contractType: the contract type offered, or unstated.',
  '- isSoftwareEngineeringRole: true when the job is mainly building or running software.',
  '- engagement: how the person is engaged (employee, contractor, eor, agency, per_task), or unstated.',
  'Use "unstated" whenever the posting does not say. Never guess.',
].join('\n');

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: KEYS,
  properties: {
    arrangement: { type: 'string', enum: codes('arrangements') },
    contractType: { type: 'string', enum: codes('contractTypes') },
    isSoftwareEngineeringRole: { type: 'boolean' },
    engagement: { type: 'string', enum: codes('engagements') },
  },
};

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model =
    process.env.PROCESSOR_EXTRACTION_MODEL ?? 'anthropic/claude-opus-5.5';
  const extraction = new OpenRouterExtractionModel(
    createOpenRouterClient(apiKey),
    model,
  );
  const todo = loadGolden().filter((c) => KEYS.some((k) => !c.drafted[k]));
  console.log(`drafting ${todo.length} cases with ${model}`);
  let cost = 0;
  for (const c of todo) {
    const input: PostingInput = {
      jobId: c.id,
      ...c.input,
      truncated: false,
    };
    const { output, meta } = await extraction.extract(input, {
      systemPrompt: SYSTEM_PROMPT,
      jsonSchema: JSON_SCHEMA,
    });
    cost += meta.costUsd;
    const answer = output as Record<DraftedKey, unknown>;
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
