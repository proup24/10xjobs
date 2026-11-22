/**
 * Runs the golden set through the generator and measures it:
 *
 *   pnpm --filter @xjobs/xjobs processor:eval -- [--posts] [--generator m]
 *
 * `--generator` defaults to `PROCESSOR_EXTRACTION_MODEL`. `--posts` runs the
 * post golden set (`golden/posts/cases.json`) through PostPipeline instead,
 * scores it against the post bars (`POST_BARS`), and writes
 * `golden/posts/last-report.<generator>.json`. Calls `claude -p`
 * (uses the Claude subscription's limits); never run in CI. Uses the same
 * generator as the worker, with in-memory repositories seeded from `seed-data.ts`,
 * so the database is not touched. Attempts are recorded with `eval: true`.
 * Prints every miss by fact (golden value → the model's, with its quote) and
 * the report, writes both to `golden/last-report.<generator>.json` and exits 1
 * unless every bar holds.
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
  reportFileName,
  scoreCase,
  summarize,
} from 'src/modules/processor/golden/score';
import { loadPostGolden } from 'src/modules/processor/golden/posts/golden-posts';
import {
  postReportFile,
  postRunPasses,
  runPostEval,
} from 'src/modules/processor/golden/posts/run-posts';
import {
  type PostEvalReport,
  summarizePosts,
} from 'src/modules/processor/golden/posts/score-posts';
import { createClaudeExtractionModel } from 'src/modules/processor/models/claude-extraction.model';
import {
  claudeBin,
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from 'src/modules/processor/models/claude/startup';
import {
  type PauseState,
  ProcessorGuard,
} from 'src/modules/processor/services/processor-guard.service';
import type { NewAttempt } from 'src/modules/processor/repositories/processor.repository';
import { extractionDocumentSchema } from 'src/modules/processor/schema';
import {
  VERDICTS,
  type Verdict,
} from 'src/modules/processor/schema/post-extraction';
import { FactAssembler } from 'src/modules/processor/services/fact-assembler.service';
import { GenerationService } from 'src/modules/processor/services/generation.service';
import { PostAssembler } from 'src/modules/processor/services/post-assembler.service';
import { PostPipeline } from 'src/modules/processor/services/post-pipeline.service';
import { createProcessorService } from 'src/modules/processor/services/processor.service';
import {
  MemoryProcessorRepository,
  MemoryVocabRepository,
} from 'src/modules/processor/testing/fakes';
import { parseEvalArgs } from './processor-args';

const CONCURRENCY = 4;
const MAX_TRIES = 3;

/** Every attempt this run records is an eval attempt. */
class EvalProcessorRepository extends MemoryProcessorRepository {
  override async recordAttempts(rows: NewAttempt[]): Promise<void> {
    await super.recordAttempts(rows.map((r) => ({ ...r, eval: true })));
  }
}

/** One wrong fact in one case, to tell a model miss from a wrong label. */
interface Miss {
  caseId: string;
  title: string;
  fact: string;
  confidence: string | null;
  want: unknown;
  got: unknown;
  quote: string;
}

/** Facts scored below full marks, and required technologies missed or added. */
function missesOf(score: FactScores, title: string): Miss[] {
  const misses: Miss[] = Object.entries(score.facts).flatMap(([fact, f]) =>
    f && f.correct < f.total
      ? [
          {
            caseId: score.caseId,
            title,
            fact,
            confidence: f.confidence,
            want: f.want,
            got: f.got,
            quote: f.quote,
          },
        ]
      : [],
  );
  const r = score.required;
  if (r && (r.missing.length > 0 || r.extra.length > 0))
    misses.push({
      caseId: score.caseId,
      title,
      fact: 'requiredTechs',
      confidence: null,
      want: r.missing.map((code) => `-${code}`),
      got: r.extra.map((code) => `+${code}`),
      quote: '',
    });
  return misses;
}

const show = (v: unknown): string =>
  v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v);

function printMisses(misses: Miss[]): void {
  if (misses.length === 0) return;
  console.log('\nmisses by fact (want → got; requiredTechs: -missing +extra):');
  const facts = [...new Set(misses.map((m) => m.fact))].sort();
  for (const fact of facts) {
    const rows = misses.filter((m) => m.fact === fact);
    console.log(`\n  ${fact} (${rows.length})`);
    for (const m of rows)
      console.log(
        `    ${m.caseId.padEnd(6)} ${m.title.slice(0, 50).padEnd(50)} ${show(m.want)} → ${show(m.got)}${m.confidence ? ` [${m.confidence}]` : ''}${m.quote ? `  "${m.quote.slice(0, 80)}"` : ''}`,
      );
  }
}

const pct = (n: number | null): string =>
  n === null ? '   n/a' : `${(n * 100).toFixed(1).padStart(5)}%`;

function print(report: EvalReport, failed: string[]): void {
  console.log(`\ncases: ${report.cases}   failed to process: ${failed.length}`);
  console.log('\nfact                       scored  accuracy');
  for (const [name, f] of Object.entries(report.facts))
    console.log(
      `${name.padEnd(26)} ${String(f.scored).padStart(5)}  ${pct(f.accuracy)}`,
    );
  const r = report.requirements;
  console.log(
    `\nrequirements: required recall ${pct(r.requiredRecall)} precision ${pct(r.requiredPrecision)}; nice recall ${pct(r.niceRecall)} precision ${pct(r.nicePrecision)}`,
  );
  console.log(
    `              kind ${pct(r.kindAccuracy)}  domain ${pct(r.domainAccuracy)}  years ${pct(r.yearsAccuracy)} (labeled cases only)`,
  );
  console.log(
    `\nsure facts contradicted: ${pct(report.sureContradicted)} of ${report.sureFacts} (cases: ${report.casesWithSureContradiction})`,
  );
  console.log(
    `per job: ${report.generatorCallsPerJob.toFixed(2)} generator calls, ${report.costPerJob.toFixed(4)} USD`,
  );
  console.log('\nbars:');
  for (const [name, ok] of Object.entries(report.bars))
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} ${name} (${name === 'sureContradicted' ? '<=' : '>='} ${BARS[name as keyof typeof BARS]})`,
    );
  console.log(`\noverall: ${report.pass ? 'PASS' : 'FAIL'}`);
}

type Env = ReturnType<typeof processorEnvironmentSchema.parse>;

/** The worker's generator; cost per job is the CLI's list-price figure. */
function claudeModel(env: Env, config: ProcessorConfig, guard: ProcessorGuard) {
  return createClaudeExtractionModel({
    model: config.extractionModel,
    effort: env.PROCESSOR_EFFORT,
    timeoutMs: env.PROCESSOR_CALL_TIMEOUT_MS,
    bin: claudeBin(process.env),
    onLimits: (limits) => guard.observeLimits(limits),
  });
}

function printPosts(report: PostEvalReport): void {
  console.log(`\nposts: ${report.cases}`);
  console.log(
    '\nlabel \\ got     hiring sure/unsure  not_hiring sure/unsure  junk sure/unsure  failed',
  );
  for (const label of VERDICTS) {
    const row = report.confusion[label];
    const cell = (v: Verdict) => `${row[v].sure}/${row[v].unsure}`.padStart(9);
    console.log(
      `${label.padEnd(14)} ${cell('hiring').padStart(18)} ${cell('not_hiring').padStart(22)} ${cell('junk').padStart(16)} ${String(row.failed).padStart(7)}`,
    );
  }
  console.log(
    `unsure by label: ${VERDICTS.map((v) => `${v} ${report.unsureByLabel[v]}`).join(', ')}`,
  );
  console.log(
    `per post: ${report.generatorCallsPerPost.toFixed(2)} generator calls, ${report.costPerPost.toFixed(4)} USD`,
  );
  const rf = report.roleFacts;
  console.log(
    `\nrole facts (reviewed roles only): ${
      Object.entries(rf.facts)
        .filter(([, f]) => f.scored > 0)
        .map(([name, f]) => `${name} ${pct(f.accuracy).trim()} of ${f.scored}`)
        .join(', ') || 'none labelled'
    }`,
  );
  console.log('\nbars:');
  const blocked = (ids: (number | string)[]) =>
    ids.length
      ? `; unreviewed labels in ${ids.length} cases: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}`
      : '';
  for (const [name, bar] of Object.entries(report.bars)) {
    const value =
      name === 'wrongSends' ? String(bar.value) : pct(bar.value).trim();
    console.log(
      `  ${bar.pass ? 'PASS' : 'FAIL'} ${name} ${value} (${name === 'wrongSends' ? '<=' : '>='} ${bar.threshold}; over ${bar.scored} cases${blocked(bar.blockedBy)})`,
    );
  }
  // A fact bar with nothing scored passes as not applying; show it as n/a.
  const scoredFor = (name: string): number =>
    name === 'sureContradicted'
      ? rf.sureFacts
      : rf.facts[name as keyof typeof rf.facts].scored;
  for (const [name, ok] of Object.entries(rf.bars))
    console.log(
      `  ${scoredFor(name) === 0 ? 'n/a ' : ok ? 'PASS' : 'FAIL'} roleFacts.${name} (${name === 'sureContradicted' ? '<=' : '>='} ${BARS[name as keyof typeof BARS]})`,
    );
  if (rf.blockedBy.length)
    console.log(`  FAIL roleFacts${blocked(rf.blockedBy)}`);
  if (report.failures.length) {
    console.log('\nfailures (case index, bar: reason):');
    for (const f of report.failures)
      console.log(`  #${String(f.index).padEnd(4)} ${f.bar}: ${f.reason}`);
  }
  console.log(`\noverall: ${report.pass ? 'PASS' : 'FAIL'}`);
}

/** The post suite: PostPipeline in memory over the post golden set. */
async function runPosts(env: Env, config: ProcessorConfig): Promise<boolean> {
  const repo = new MemoryProcessorRepository();
  const guard = new ProcessorGuard(repo, config);
  const facts = new FactAssembler();
  const pipeline = new PostPipeline(
    new GenerationService(claudeModel(env, config, guard), facts, config),
    new PostAssembler(facts),
  );
  const run = await runPostEval({
    cases: loadPostGolden(),
    pipeline,
    guard,
    vocabulary: await new MemoryVocabRepository().snapshot(),
    concurrency: CONCURRENCY,
    maxTries: MAX_TRIES,
    onScore: (s) =>
      console.log(
        `  #${s.index}: ${s.got ? `${s.got.value} (${s.got.confidence})` : 'failed'}`,
      ),
  });
  const report = summarizePosts(run.scores);
  // A case that did not generate, or did not run, proves nothing, so it fails the run.
  const pass = postRunPasses(report, run);
  printPosts({ ...report, pass });
  const failed = run.scores.filter((s) => s.failed).length;
  if (failed)
    console.log(`\n${failed} posts failed to generate (see failures)`);
  const limit = run.limitStop;
  if (limit)
    console.log(
      `\n${limit.reason === 'auth' ? 'STOPPED: provider unavailable' : `STOPPED ON A LIMIT (${limit.reason}, until ${limit.until.toISOString()})`}: ${limit.detail}\n${run.notRun.length} posts not run; the scores above cover only the ${run.scores.length} that ran. Re-run after ${limit.reason === 'auth' ? 'fixing the provider' : 'the reset'}.`,
    );
  writeFileSync(
    postReportFile(config.extractionModel),
    `${JSON.stringify({ ...report, pass, stoppedOnLimit: limit, notRun: run.notRun, config, scores: run.scores }, null, 2)}\n`,
  );
  return pass;
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2));
  loadEnvironmentFiles();
  const env = processorEnvironmentSchema.parse(process.env);
  if (!hasClaudeCredential(env)) throw new Error(NO_CLAUDE_CREDENTIAL);
  const config: ProcessorConfig = {
    extractionModel: args.generator ?? env.PROCESSOR_EXTRACTION_MODEL,
    concurrency: CONCURRENCY,
    maxAttempts: MAX_TRIES,
    claimTimeoutMs: env.PROCESSOR_CLAIM_TIMEOUT_MS,
    // No budget cap; the weekly reserve still stops the run.
    dailyBudgetUsd: 0,
    weeklyStopAt: env.PROCESSOR_WEEKLY_STOP_AT,
    generationTries: env.PROCESSOR_GENERATION_TRIES,
    postDailyCap: env.POST_EXTRACTION_DAILY_CAP,
  };
  console.log(`generator ${config.extractionModel}`);
  if (args.posts) process.exit((await runPosts(env, config)) ? 0 : 1);

  const repo = new EvalProcessorRepository();
  const guard = new ProcessorGuard(repo, config);
  const service = createProcessorService({
    repo,
    vocab: new MemoryVocabRepository(),
    extraction: claudeModel(env, config, guard),
    guard,
    config,
  });

  const cases = loadGolden();
  for (const c of cases)
    repo.addJob({
      id: c.id,
      title: c.input.title,
      descriptionText: c.input.description,
    });

  const scores: FactScores[] = [];
  const misses: Miss[] = [];
  const failed: string[] = [];
  /** Cases not run because a usage limit or the weekly reserve paused the run. */
  const stopped: string[] = [];
  let limitStop: PauseState | null = null;
  const queue = [...cases];
  const worker = async (): Promise<void> => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const run = () => service.process(c.id);
      let outcome = await run();
      for (let i = 1; outcome === 'retry' && i < MAX_TRIES; i++)
        outcome = await run();
      const pause = guard.pauseState();
      if (
        (outcome === 'paused' || outcome === 'retry') &&
        (pause?.reason === 'usage_limit' || pause?.reason === 'weekly_reserve')
      ) {
        // Not a quality failure: the subscription stopped the run.
        limitStop ??= pause;
        stopped.push(c.id, ...queue.splice(0).map((q) => q.id));
        continue;
      }
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
      const score = scoreCase(parsed.data, c, calls);
      scores.push(score);
      misses.push(...missesOf(score, c.input.title));
      console.log(`  ${c.id}: ${outcome}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const report = summarize(scores);
  // A case that did not process proves nothing, so it fails the run.
  const pass = report.pass && failed.length === 0 && stopped.length === 0;
  printMisses(
    misses.sort((a, b) =>
      a.caseId.localeCompare(b.caseId, undefined, { numeric: true }),
    ),
  );
  print({ ...report, pass }, failed);
  if (failed.length)
    console.log(`\nfailed cases:\n${failed.map((f) => `  ${f}`).join('\n')}`);
  const limit = limitStop as PauseState | null;
  if (limit)
    console.log(
      `\nSTOPPED ON A LIMIT (${limit.reason}, until ${limit.until.toISOString()}): ${limit.detail}\n${stopped.length} cases not run; the scores above cover only the ${scores.length + failed.length} that ran. Re-run after the reset.`,
    );
  writeFileSync(
    join(GOLDEN_CASES_DIR, '..', reportFileName(config.extractionModel)),
    `${JSON.stringify({ ...report, pass, failed, stoppedOnLimit: limit, notRun: stopped, config, misses }, null, 2)}\n`,
  );
  process.exit(pass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
