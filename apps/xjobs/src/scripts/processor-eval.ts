/**
 * Runs the golden set through generate -> verify -> regenerate and measures it:
 *
 *   pnpm --filter @xjobs/xjobs processor:eval -- [--generator m] [--decision-model m]
 *
 * `--generator` defaults to `PROCESSOR_EXTRACTION_MODEL` (run once with Opus
 * and once with DeepSeek to compare them), `--decision-model` to
 * `PROCESSOR_DECISION_MODEL`. Calls paid APIs; never run in CI. Uses the real
 * OpenRouter adapters with in-memory repositories seeded from `seed-data.ts`,
 * so the database is not touched. Attempts are recorded with `eval: true`.
 * Prints the report, writes `golden/last-report.<generator>.json` and exits 1
 * unless every bar holds. It only suggests thresholds: update
 * `config/thresholds.ts` by hand from the report.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvironmentFiles } from '@xjobs/database/env';
import { processorEnvironmentSchema } from 'src/config/environment.validation';
import type { ProcessorConfig } from 'src/modules/processor/config/processor.config';
import {
  loadGolden,
  GOLDEN_CASES_DIR,
} from 'src/modules/processor/golden/golden';
import {
  BARS,
  callStats,
  type EvalReport,
  type FactScores,
  questionLine,
  reportFileName,
  scoreCase,
  summarize,
} from 'src/modules/processor/golden/score';
import { OpenRouterDecisionModel } from 'src/modules/processor/models/decision.model';
import { AiSdkExtractionModel } from 'src/modules/processor/models/extraction.model';
import {
  checkModels,
  createOpenRouterClient,
} from 'src/modules/processor/models/client';
import { ModelPricing } from 'src/modules/processor/models/pricing';
import type { NewAttempt } from 'src/modules/processor/repositories/processor.repository';
import { extractionDocumentSchema } from 'src/modules/processor/schema';
import type { FieldVerdict } from 'src/modules/processor/rules/verify';
import { VerificationService } from 'src/modules/processor/services/verification.service';
import { createProcessorService } from 'src/modules/processor/services/processor.service';
import {
  MemoryProcessorRepository,
  MemoryVocabRepository,
} from 'src/modules/processor/testing/fakes';

const CONCURRENCY = 4;
const MAX_TRIES = 3;

/** Keeps what every verification round returned, per job, for the all-rounds scores. */
class RecordingVerificationService extends VerificationService {
  readonly rounds = new Map<string, FieldVerdict[][]>();
  override async verify(
    ...args: Parameters<VerificationService['verify']>
  ): Promise<FieldVerdict[]> {
    const verdicts = await super.verify(...args);
    const jobId = args[1].jobId;
    this.rounds.set(jobId, [...(this.rounds.get(jobId) ?? []), verdicts]);
    return verdicts;
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
    '\nfact                       scored  accuracy  generator ingest',
  );
  for (const [name, f] of Object.entries(report.facts))
    console.log(
      `${name.padEnd(26)} ${String(f.scored).padStart(5)}  ${pct(f.accuracy)}   ${pct(f.generatorShare)} ${pct(f.ingestShare)}`,
    );
  console.log(
    '\nclosed field               verified  confirmed unconfirmed rejected',
  );
  for (const [name, v] of Object.entries(report.verdicts))
    console.log(
      `${name.padEnd(26)} ${String(v.verified).padStart(8)}  ${pct(v.confirmed)}    ${pct(v.unconfirmed)}   ${pct(v.rejected)}`,
    );
  console.log(
    `\nJev rejection precision: ${pct(report.rejectionPrecision)} of ${report.rejections} final rejections, ${pct(report.rejectionPrecisionAllRounds)} of ${report.rejectionsAllRounds} rejections in every round, were wrong generator values`,
  );
  const r = report.requirements;
  console.log(
    `\nrequirements: required recall ${pct(r.requiredRecall)} precision ${pct(r.requiredPrecision)}; nice recall ${pct(r.niceRecall)} precision ${pct(r.nicePrecision)}`,
  );
  console.log(
    `              kind ${pct(r.kindAccuracy)}  domain ${pct(r.domainAccuracy)}  years ${pct(r.yearsAccuracy)} (labeled cases only)`,
  );
  console.log(
    '\nJev accuracy by score bucket (correct/total), suggested threshold (confirmations accepted):',
  );
  for (const [q, r] of Object.entries(report.questions))
    console.log(questionLine(q, r));
  console.log(
    `\nsure facts contradicted: ${pct(report.sureContradicted)} of ${report.sureFacts} (cases: ${report.casesWithSureContradiction})`,
  );
  console.log(
    `per job: ${report.roundsPerJob.toFixed(2)} rounds, ${report.generatorCallsPerJob.toFixed(2)} generator calls, ${report.verifierCallsPerJob.toFixed(2)} Jev calls, ${report.costPerJob.toFixed(4)} USD`,
  );
  console.log('\nbars:');
  for (const [name, ok] of Object.entries(report.bars))
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} ${name} (${name === 'sureContradicted' ? '<=' : '>='} ${BARS[name as keyof typeof BARS]})`,
    );
  console.log('\nsuggested thresholds for config/thresholds.ts (not applied):');
  for (const [q, r] of Object.entries(report.questions))
    console.log(
      `  ${q}: ${r.suggestedThreshold ?? 'no safe threshold; keep the current one'},`,
    );
  console.log(`\noverall: ${report.pass ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const env = processorEnvironmentSchema.parse(process.env);
  const config: ProcessorConfig = {
    decisionModel: flag('decision-model') ?? env.PROCESSOR_DECISION_MODEL,
    extractionModel: flag('generator') ?? env.PROCESSOR_EXTRACTION_MODEL,
    concurrency: CONCURRENCY,
    maxAttempts: MAX_TRIES,
    claimTimeoutMs: env.PROCESSOR_CLAIM_TIMEOUT_MS,
    dailyBudgetUsd: Number.MAX_SAFE_INTEGER,
    maxRegenerations: env.PROCESSOR_MAX_REGENERATIONS,
    generationTries: env.PROCESSOR_GENERATION_TRIES,
  };
  console.log(
    `verifier ${config.decisionModel}, generator ${config.extractionModel}`,
  );

  const client = createOpenRouterClient(apiKey);
  // Cost per job is a bar: a response without a cost is estimated, not 0.
  const pricing = new ModelPricing();
  pricing.set(await checkModels(client, config));
  const decision = new OpenRouterDecisionModel(
    client,
    config.decisionModel,
    pricing,
  );
  const verification = new RecordingVerificationService(decision, config);
  const repo = new EvalProcessorRepository();
  const service = createProcessorService({
    repo,
    vocab: new MemoryVocabRepository(),
    decision,
    verification,
    extraction: new AiSdkExtractionModel(
      apiKey,
      config.extractionModel,
      pricing,
    ),
    config,
  });

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
      // Only the rounds of the try that produced the stored document count.
      const run = () => {
        verification.rounds.delete(c.id);
        return service.process(c.id);
      };
      let outcome = await run();
      for (let i = 1; outcome === 'retry' && i < MAX_TRIES; i++)
        outcome = await run();
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
      // Every try of the job counts toward its calls and cost.
      const calls = callStats(repo.attempts.filter((a) => a.jobId === c.id));
      scores.push(
        scoreCase(parsed.data, c, {
          ...calls,
          roundVerdicts: verification.rounds.get(c.id),
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
    join(GOLDEN_CASES_DIR, '..', reportFileName(config.extractionModel)),
    `${JSON.stringify({ ...report, pass, failed, config }, null, 2)}\n`,
  );
  process.exit(pass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
