import { join } from 'node:path';
import {
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from '../../models/errors';
import type { Vocabulary } from '../../repositories/vocab.repository';
import { buildPostInput } from '../../rules/post-input';
import { AttemptLog } from '../../services/attempt-log';
import { ExtractionFailed } from '../../services/extraction-pipeline.service';
import type { PostPipeline } from '../../services/post-pipeline.service';
import {
  type PauseState,
  PROVIDER_PAUSE_MS,
  type ProcessorGuard,
  USAGE_LIMIT_FALLBACK_MS,
} from '../../services/processor-guard.service';
import { callStats, reportFileName } from '../score';
import type { PostDocument } from '../../schema/post-extraction';
import type { PostGoldenCase } from './golden-posts';
import { type PostEvalReport, type PostScore, scorePost } from './score-posts';

/** Where `processor:eval -- --posts` writes the report of a run with `generator`. */
export const postReportFile = (generator: string): string =>
  join(__dirname, reportFileName(generator));

/** Where a `--case` run writes its report, so a partial run never overwrites the full one. */
export const postCasesReportFile = (generator: string): string =>
  postReportFile(generator).replace(/\.json$/, '.cases.json');

export interface PostEvalRun {
  scores: PostScore[];
  /** Case indices not run because a usage limit, the weekly reserve or the provider stopped the run. */
  notRun: number[];
  /** Why the run stopped; reason `auth` when the provider was unavailable. */
  limitStop: PauseState | null;
}

const STOP_REASONS = new Set(['usage_limit', 'weekly_reserve', 'auth']);

/** The run passes only when the bars hold, every case generated and none was left unrun. */
export const postRunPasses = (
  report: Pick<PostEvalReport, 'pass'>,
  run: Pick<PostEvalRun, 'scores' | 'notRun'>,
): boolean =>
  report.pass &&
  run.notRun.length === 0 &&
  run.scores.every((s) => s.failed === null);

/** A subset run has no bars; it is fine when every case generated and nothing stopped it. */
export const subsetRunOk = (
  run: Pick<PostEvalRun, 'notRun'> & { scores: Pick<PostScore, 'failed'>[] },
): boolean =>
  run.notRun.length === 0 && run.scores.every((s) => s.failed === null);

/**
 * Runs every post case (or only those at the `only` indices; scores keep the
 * case's index in `cases`) through the pipeline in memory: no repository, no
 * database, nothing saved. A transient failure is retried up to `maxTries`;
 * a usage limit (or the weekly reserve the model's limits report to `guard`)
 * or an unavailable provider stops the run, and the cases left are listed, not scored. Every try's
 * calls count toward the case's calls and cost.
 */
export async function runPostEval(options: {
  cases: PostGoldenCase[];
  pipeline: PostPipeline;
  guard: ProcessorGuard;
  vocabulary: Vocabulary;
  concurrency?: number;
  maxTries?: number;
  /** 0-based indices into `cases` to run; every case when omitted. */
  only?: readonly number[];
  /** Called per scored case, with the extracted document (null when it failed). */
  onScore?: (score: PostScore, doc: PostDocument | null) => void;
}): Promise<PostEvalRun> {
  const { cases, pipeline, guard, vocabulary } = options;
  const maxTries = options.maxTries ?? 3;
  const scores: PostScore[] = [];
  const notRun: number[] = [];
  let limitStop: PauseState | null = null;
  const queue = cases
    .map((c, index) => ({ c, index }))
    .filter(
      ({ index }) => options.only === undefined || options.only.includes(index),
    );

  const limitPause = (): PauseState | null => {
    const pause = guard.pauseState();
    return pause && STOP_REASONS.has(pause.reason) ? pause : null;
  };
  const stop = (index: number, pause: PauseState): void => {
    limitStop ??= pause;
    notRun.push(index, ...queue.splice(0).map((q) => q.index));
  };

  const record = (score: PostScore, doc: PostDocument | null): void => {
    scores.push(score);
    options.onScore?.(score, doc);
  };

  const runOne = async (c: PostGoldenCase, index: number): Promise<void> => {
    const post = buildPostInput({
      id: `golden-post-${index}`,
      closed: false,
      title: null,
      descriptionText: null,
      kind: 'post',
      postSources: c.sources,
    });
    const logs: AttemptLog[] = [];
    for (let attempt = 1; ; attempt++) {
      const log = new AttemptLog(`golden-post-${index}`, { docType: 'post' });
      logs.push(log);
      const calls = () => callStats(logs.flatMap((l) => l.entries()));
      try {
        const assembled = await pipeline.run(post, vocabulary, log);
        record(scorePost(c, assembled, { index, ...calls() }), assembled.doc);
        return;
      } catch (error) {
        // Not a quality failure: the subscription or the provider stopped the run.
        if (error instanceof UsageLimitError) {
          const resetsAt = error.limit?.resetsAt ?? null;
          guard.pauseForUsageLimit(resetsAt, error.message);
          const now = Date.now();
          stop(index, {
            reason: 'usage_limit',
            until:
              resetsAt && resetsAt.getTime() > now
                ? resetsAt
                : new Date(now + USAGE_LIMIT_FALLBACK_MS),
            detail: error.message,
          });
          return;
        }
        if (error instanceof ProviderUnavailableError) {
          guard.pause(error);
          stop(index, {
            reason: 'auth',
            until: new Date(Date.now() + PROVIDER_PAUSE_MS),
            detail: error.message,
          });
          return;
        }
        if (error instanceof TransientModelError && attempt < maxTries)
          continue;
        const failed =
          error instanceof ExtractionFailed
            ? error.errors
            : [error instanceof Error ? error.message : String(error)];
        record(scorePost(c, { failed }, { index, ...calls() }), null);
        return;
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const pause = limitPause();
      if (pause) {
        stop(next.index, pause);
        return;
      }
      await runOne(next.c, next.index);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
  scores.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  notRun.sort((a, b) => a - b);
  return { scores, notRun, limitStop };
}
