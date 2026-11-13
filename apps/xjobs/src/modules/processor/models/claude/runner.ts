import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeEnv } from './env';

export interface ClaudeCall {
  model: string;
  systemPrompt: string;
  userMessage: string;
  jsonSchema: object;
  effort: string;
  timeoutMs: number;
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  latencyMs: number;
}

const STDERR_CAP = 64 * 1024;

/**
 * Runs one `claude -p` child per call, isolated: an empty working directory,
 * an empty HOME, the system prompt in a file beside them, and only the
 * variables `claudeEnv` allows. `extraEnv` is for tests only.
 */
export class ClaudeRunner {
  private readonly bin: string;
  private readonly source: NodeJS.ProcessEnv;
  private readonly extraEnv: Record<string, string>;
  private readonly maxTurns: number;

  constructor(opts: {
    bin?: string;
    env?: NodeJS.ProcessEnv;
    extraEnv?: Record<string, string>;
    maxTurns: number;
  }) {
    this.bin = opts.bin ?? 'claude';
    this.source = opts.env ?? process.env;
    this.extraEnv = opts.extraEnv ?? {};
    this.maxTurns = opts.maxTurns;
  }

  async run(call: ClaudeCall): Promise<ClaudeRunResult> {
    const root = await mkdtemp(join(tmpdir(), 'xjobs-claude-'));
    try {
      const cwd = join(root, 'cwd');
      const home = join(root, 'home');
      const promptDir = join(root, 'prompt');
      await Promise.all([cwd, home, promptDir].map((d) => mkdir(d)));
      const promptFile = join(promptDir, 'system.md');
      await writeFile(promptFile, call.systemPrompt);

      const env = { ...claudeEnv(this.source, home), ...this.extraEnv };
      const args = [
        '-p',
        '--system-prompt-file',
        promptFile,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--output-format',
        'stream-json',
        '--verbose',
        '--json-schema',
        JSON.stringify(call.jsonSchema),
        '--model',
        call.model,
        '--effort',
        call.effort,
        '--max-turns',
        String(this.maxTurns),
        '--tools',
        '',
      ];
      return await this.spawnChild(args, { cwd, env }, call);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private spawnChild(
    args: string[],
    opts: { cwd: string; env: Record<string, string> },
    call: ClaudeCall,
  ): Promise<ClaudeRunResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        ...opts,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      let err = Buffer.alloc(0);
      let timedOut = false;
      let settled = false;

      const killGroup = () => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
        finish(null);
      }, call.timeoutMs);

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: err.toString('utf8'),
          code,
          timedOut,
          latencyMs: Date.now() - started,
        });
      };

      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killGroup();
        reject(new Error(`could not run claude (${this.bin}): ${e.message}`));
      });
      child.stdout.on('data', (b: Buffer) => out.push(b));
      child.stderr.on('data', (b: Buffer) => {
        err = Buffer.concat([err, b]);
        if (err.length > STDERR_CAP)
          err = err.subarray(err.length - STDERR_CAP);
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(call.userMessage);
      child.on('close', (code) => {
        killGroup();
        finish(code);
      });
    });
  }
}
