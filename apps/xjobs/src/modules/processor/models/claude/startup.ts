import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ClaudeAuthError,
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
  UsageLimitError,
} from '../errors';
import type { ExtractionModel } from '../types';
import type { CallFailure } from './stream';
import { CLAUDE_CODE_VERSION } from './version';

/** Injection token: the `claude` binary the processor spawns. */
export const CLAUDE_BIN = Symbol('CLAUDE_BIN');

/** Why the processor cannot run: neither credential is set. */
export const NO_CLAUDE_CREDENTIAL =
  'no Claude credential (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)';

/** True when `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is non-empty. */
export function hasClaudeCredential(env: {
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
}): boolean {
  return Boolean(env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY);
}

/**
 * The `claude` binary to spawn. `XJOBS_CLAUDE_BIN` points the tests at the
 * fake and is read only when `NODE_ENV=test`; otherwise `claude` from PATH.
 */
export function claudeBin(env: {
  NODE_ENV?: string;
  XJOBS_CLAUDE_BIN?: string;
}): string {
  return env.NODE_ENV === 'test' && env.XJOBS_CLAUDE_BIN
    ? env.XJOBS_CLAUDE_BIN
    : 'claude';
}

const VERSION_TIMEOUT_MS = 30_000;

/**
 * Throws unless `claude --version` reports `CLAUDE_CODE_VERSION`. Runs with
 * only PATH and an empty HOME: `--version` needs no credential.
 */
export async function checkClaudeInstalled(bin = 'claude'): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'xjobs-claude-version-'));
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        bin,
        ['--version'],
        {
          env: { PATH: process.env.PATH ?? '', HOME: home },
          cwd: home,
          timeout: VERSION_TIMEOUT_MS,
        },
        (error, out) => {
          if (error)
            reject(
              new Error(
                `could not run \`${bin} --version\`: ${error.message}; install Claude Code ${CLAUDE_CODE_VERSION}`,
              ),
            );
          else resolve(String(out));
        },
      );
    });
    const version = /^\s*(\d+\.\d+\.\d+)\s+\(Claude Code\)/.exec(stdout)?.[1];
    if (!version)
      throw new Error(
        `could not read the Claude Code version from \`${bin} --version\`: ${stdout.trim().slice(0, 200)}`,
      );
    if (version !== CLAUDE_CODE_VERSION)
      throw new Error(
        `Claude Code ${version} is installed; the processor needs exactly ${CLAUDE_CODE_VERSION}`,
      );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const CHECK_SCHEMA = z.strictObject({ title: z.string(), remote: z.boolean() });

const CHECK_PROMPT =
  'Read the job posting. Answer with its job title and whether the job is fully remote.';

/**
 * One tiny extraction-shaped call with the processor's model and flags, to
 * prove the credential works. Null on success, else what went wrong.
 */
export async function checkClaudeCall(
  model: ExtractionModel,
): Promise<CallFailure | null> {
  try {
    await model.generate(
      {
        jobId: 'startup-check',
        title: 'Senior Backend Engineer (TypeScript)',
        description:
          'We are hiring a Senior Backend Engineer to build TypeScript services. Fully remote.',
        truncated: false,
      },
      { systemPrompt: CHECK_PROMPT, schema: CHECK_SCHEMA },
    );
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageLimitError)
      return { kind: 'usage_limit', limit: error.limit };
    if (error instanceof ClaudeAuthError) return { kind: 'auth' };
    if (error instanceof ProviderUnavailableError)
      return { kind: 'request', reason };
    if (error instanceof TransientModelError)
      return { kind: 'transient', reason };
    if (error instanceof ModelOutputError) return { kind: 'output', reason };
    if (error instanceof ModelRequestError) return { kind: 'request', reason };
    return { kind: 'transient', reason };
  }
}

/** One line for a failed check, for the pause detail. */
export function describeFailure(failure: CallFailure): string {
  switch (failure.kind) {
    case 'auth':
      return 'Claude refused the credential. Run `claude setup-token`, update the server .env, and restart the worker.';
    case 'usage_limit':
      return 'the Claude usage limit is reached';
    default:
      return `the startup call failed (${failure.kind}): ${failure.reason}`;
  }
}
