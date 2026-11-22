import { join } from 'node:path';
import { TransientModelError, UsageLimitError } from '../../models/errors';
import type { Vocabulary } from '../../repositories/vocab.repository';
import { buildPostInput } from '../../rules/post-input';
import { AttemptLog } from '../../services/attempt-log';
import { ExtractionFailed } from '../../services/extraction-pipeline.service';
import type { PostPipeline } from '../../services/post-pipeline.service';
import type {
  PauseState,
  ProcessorGuard,
} from '../../services/processor-guard.service';
import { callStats, reportFileName } from '../score';
import type { PostGoldenCase } from './golden-posts';
import { type PostScore, scorePost } from './score-posts';

/** Where `processor:eval -- --posts` writes the report of a run with `generator`. */
export const postReportFile = (generator: string): string =>
  join(__dirname, reportFileName(generator));

export interface PostEvalRun {
  scores: PostScore[];
  /** Case indices not run because a usage limit or the weekly reserve stopped the run. */
  notRun: number[];
  limitStop: PauseState | null;
}

const LIMIT_REASONS = new Set(['usage_limit', 'weekly_reserve']);

/**
 * Runs every post case through the pipeline in memory: no repository, no
 * database, nothing saved. A transient failure is retried up to `maxTries`;
 * a usage limit (or the weekly reserve the model's limits report to `guard`)
 * stops the run, and the cases left are listed, not scored. Every try's
 * calls count toward the case's calls and cost.
 */
export async function runPostEval(options: {
  cases: PostGoldenCase[];
  pipeline: PostPipeline;
  guard: ProcessorGuard;
  vocabulary: Vocabulary;
  concurrency?: number;
  maxTries?: number;
  onScore?: (score: PostScore) => void;
}): Promise<PostEvalRun> {
  const { cases, pipeline, guard, vocabulary } = options;
  const maxTries = options.maxTries ?? 3;
  const scores: PostScore[] = [];
  const notRun: number[] = [];
  let limitStop: PauseState | null = null;
  const queue = cases.map((c, index) => ({ c, index }));

  const limitPause = (): PauseState | null => {
    const pause = guard.pauseState();
    return pause && LIMIT_REASONS.has(pause.reason) ? pause : null;
  };
  const stop = (index: number, pause: PauseState): void => {
    limitStop ??= pause;
    notRun.push(index, ...queue.splice(0).map((q) => q.index));
  };

  const record = (score: PostScore): void => {
    scores.push(score);
    options.onScore?.(score);
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
        record(scorePost(c, assembled, { index, ...calls() }));
        return;
      } catch (error) {
        if (error instanceof UsageLimitError) {
          guard.pauseForUsageLimit(
            error.limit?.resetsAt ?? null,
            error.message,
          );
          // Not a quality failure: the subscription stopped the run.
          stop(index, limitPause() as PauseState);
          return;
        }
        if (error instanceof TransientModelError && attempt < maxTries)
          continue;
        const failed =
          error instanceof ExtractionFailed
            ? error.errors
            : [error instanceof Error ? error.message : String(error)];
        record(scorePost(c, { failed }, { index, ...calls() }));
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
