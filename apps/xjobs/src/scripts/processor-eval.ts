/**
 * Runs the golden set through the real pipeline and measures it:
 *
 *   pnpm --filter @xjobs/xjobs processor:eval -- [--decision-model m] [--extraction-model m]
 *
 * Calls paid APIs; never run in CI. Uses the real OpenRouter adapters with
 * in-memory repositories seeded from `seed-data.ts`, so the database is not
 * touched. Attempts are recorded with `eval: true`. Prints the report, writes
 * `golden/last-report.json` and exits 1 unless every bar holds. It only
 * suggests thresholds: update `config/thresholds.ts` by hand from the report.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvironmentFiles } from 'src/config/environment.loader';
import type { ProcessorConfig } from 'src/modules/processor/config/processor.config';
import {
  loadGolden,
  GOLDEN_CASES_DIR,
} from 'src/modules/processor/golden/golden';
import {
  BARS,
  type EvalReport,
  type FactScores,
  questionLine,
  scoreCase,
  summarize,
} from 'src/modules/processor/golden/score';
import { OpenRouterDecisionModel } from 'src/modules/processor/models/openrouter-decision.model';
import { OpenRouterExtractionModel } from 'src/modules/processor/models/openrouter-extraction.model';
import {
  checkModels,
  createOpenRouterClient,
} from 'src/modules/processor/models/openrouter.client';
import { ModelPricing } from 'src/modules/processor/models/pricing';
import {
  type DecisionAnswer,
  DecisionModel,
  type DecisionQuestion,
  type PostingInput,
} from 'src/modules/processor/models/types';
import { ProcessJobService } from 'src/modules/processor/pipeline/process-job.service';
import type { NewAttempt } from 'src/modules/processor/repositories/processor.repository';
import { extractionDocumentSchema } from 'src/modules/processor/schema';
import {
  MemoryProcessorRepository,
  MemoryVocabRepository,
} from 'src/modules/processor/testing/fakes';

const CONCURRENCY = 4;
const MAX_TRIES = 3;

/** Keeps Jev's raw answers, which the document drops when Opus takes over. */
class RecordingDecisionModel extends DecisionModel {
  readonly answers = new Map<string, DecisionAnswer[]>();
  constructor(private readonly inner: DecisionModel) {
    super();
  }
  async decide(input: PostingInput, questions: DecisionQuestion[]) {
    const result = await this.inner.decide(input, questions);
    this.answers.set(input.jobId, result.answers);
    return result;
  }
}

/** Every attempt this run records is an eval attempt. */
class EvalProcessorRepository extends MemoryProcessorRepository {
  override async recordAttempts(rows: NewAttempt[]): Promise<void> {
    await super.recordAttempts(rows.map((r) => ({ ...r, eval: true })));
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const pct = (n: number | null): string =>
  n === null ? '   n/a' : `${(n * 100).toFixed(1).padStart(5)}%`;

function print(report: EvalReport, failed: string[]): void {
  console.log(`\ncases: ${report.cases}   failed to process: ${failed.length}`);
  console.log(
    '\nfact                       scored  accuracy   jev    opus   ingest',
  );
  for (const [name, f] of Object.entries(report.facts))
    console.log(
      `${name.padEnd(26)} ${String(f.scored).padStart(5)}  ${pct(f.accuracy)}  ${pct(f.jevShare)} ${pct(f.opusShare)} ${pct(f.ingestShare)}`,
    );
  console.log(
    '\nJev accuracy by score bucket (correct/total), suggested threshold (accepted answers):',
  );
  for (const [q, r] of Object.entries(report.questions))
    console.log(questionLine(q, r));
  console.log(
    `\nsure facts contradicted: ${pct(report.sureContradicted)} of ${report.sureFacts} (cases: ${report.casesWithSureContradiction})`,
  );
  console.log(`cost per job: ${report.costPerJob.toFixed(4)} USD`);
  console.log('\nbars:');
  for (const [name, ok] of Object.entries(report.bars))
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} ${name} (${name === 'sureContradicted' ? '<=' : '>='} ${BARS[name as keyof typeof BARS]})`,
    );
  console.log('\nsuggested thresholds for config/thresholds.ts (not applied):');
  for (const [q, r] of Object.entries(report.questions))
    console.log(
      `  ${q}: ${r.suggestedThreshold ?? 'no safe threshold; keep 0.8 or route to Opus'},`,
    );
  console.log(`\noverall: ${report.pass ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const config: ProcessorConfig = {
    decisionModel:
      flag('decision-model') ??
      process.env.PROCESSOR_DECISION_MODEL ??
      'typesafe/jev-1.14',
    extractionModel:
      flag('extraction-model') ??
      process.env.PROCESSOR_EXTRACTION_MODEL ??
      'anthropic/claude-opus-5.5',
    concurrency: CONCURRENCY,
    maxAttempts: MAX_TRIES,
    claimTimeoutMs: 900_000,
    dailyBudgetUsd: Number.MAX_SAFE_INTEGER,
  };
  console.log(
    `decision ${config.decisionModel}, extraction ${config.extractionModel}`,
  );

  const client = createOpenRouterClient(apiKey);
  // Cost per job is a bar: a response without a cost is estimated, not 0.
  const pricing = new ModelPricing();
  pricing.set(await checkModels(client, config));
  const decision = new RecordingDecisionModel(
    new OpenRouterDecisionModel(client, config.decisionModel, pricing),
  );
  const repo = new EvalProcessorRepository();
  const service = new ProcessJobService(
    repo,
    new MemoryVocabRepository(),
    decision,
    new OpenRouterExtractionModel(client, config.extractionModel, pricing),
    config,
  );

  const cases = loadGolden();
  for (const c of cases)
    repo.addJob({
      id: c.id,
      title: c.input.title,
      companyName: c.input.companyName,
      descriptionText: c.input.description,
      evidence: c.input.evidence,
    });

  const scores: FactScores[] = [];
  const failed: string[] = [];
  const queue = [...cases];
  const worker = async (): Promise<void> => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let outcome = await service.process(c.id);
      for (let i = 1; outcome === 'retry' && i < MAX_TRIES; i++)
        outcome = await service.process(c.id);
      const job = repo.jobs.get(c.id);
      const stored = repo.extractions.find(
        (e) => e.id === job?.currentExtractionId,
      );
      const parsed = extractionDocumentSchema.safeParse(stored?.data);
      if (!parsed.success) {
        failed.push(
          `${c.id} (${outcome}${job?.processingError ? `: ${job.processingError}` : ''})`,
        );
        continue;
      }
      const costUsd = repo.attempts
        .filter((a) => a.jobId === c.id)
        .reduce((sum, a) => sum + a.costUsd, 0);
      scores.push(
        scoreCase(parsed.data, c, {
          jevAnswers: decision.answers.get(c.id),
          costUsd,
        }),
      );
      console.log(`  ${c.id}: ${outcome}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const report = summarize(scores);
  // A case that did not process proves nothing, so it fails the run.
  const pass = report.pass && failed.length === 0;
  print({ ...report, pass }, failed);
  if (failed.length)
    console.log(`\nfailed cases:\n${failed.map((f) => `  ${f}`).join('\n')}`);
  writeFileSync(
    join(GOLDEN_CASES_DIR, '..', 'last-report.json'),
    `${JSON.stringify({ ...report, pass, failed, config }, null, 2)}\n`,
  );
  process.exit(pass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
