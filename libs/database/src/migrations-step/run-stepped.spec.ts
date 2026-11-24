import { beforeEach, describe, expect, it } from 'vitest';
import { runStepped, type RunDeps } from './run-stepped.js';
import type { Marker, MigrationEdge, RefFile } from './plan-steps.js';

const names = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function edge(
  from: string | null,
  to: string,
  provided: string[] = [],
): MigrationEdge {
  return {
    dirName: `${from}-${to}`,
    from,
    to,
    providedInvariants: provided,
    createdAt: '2026-01-01T00:00:00.000Z',
    migrationHash: `mh-${from}-${to}`,
  };
}

const a = names('a', 8);
const b = names('b', 8);
const edges = [edge(null, 'A', a), edge('A', 'B', b), edge('B', 'C', ['c0'])];
const dbRef: RefFile = { hash: 'C', invariants: [...a, ...b, 'c0'] };
const input = { edges, dbRef, runId: '42' };

class FakeDeps implements RunDeps {
  marker: Marker | null = null;
  written = new Map<string, RefFile>();
  prismaCalls: string[][] = [];
  logs: string[] = [];
  warnings: string[] = [];
  private failAt = new Map<number, number>();
  throwOnCall: number | null = null;

  failOnCall(call: number, code: number) {
    this.failAt.set(call, code);
  }
  async readMarker() {
    return this.marker;
  }
  writeRef(name: string, ref: RefFile) {
    this.written.set(name, ref);
  }
  removeRef(name: string) {
    this.written.delete(name);
  }
  async runPrisma(args: string[]) {
    this.prismaCalls.push(args);
    const n = this.prismaCalls.length;
    if (this.throwOnCall === n) throw new Error('spawn failed');
    return this.failAt.get(n) ?? 0;
  }
  log(message: string) {
    this.logs.push(message);
  }
  warn(message: string) {
    this.warnings.push(message);
  }
}

describe('runStepped', () => {
  let deps: FakeDeps;
  beforeEach(() => {
    deps = new FakeDeps();
  });

  it('refuses any argument without running prisma', async () => {
    expect(await runStepped(['--show'], input, deps)).toBe(2);
    expect(deps.prismaCalls).toEqual([]);
    expect(deps.warnings.length).toBeGreaterThan(0);
  });

  it('runs each step ref then db, and removes the refs', async () => {
    let seen: string[] = [];
    const run = deps.runPrisma.bind(deps);
    deps.runPrisma = async (args) => {
      seen = [...seen, ...deps.written.keys()];
      return run(args);
    };
    expect(await runStepped([], input, deps)).toBe(0);
    expect(deps.prismaCalls).toEqual([
      ['db', 'migrate', '--to', 'step-42-1'],
      ['db', 'migrate', '--to', 'step-42-2'],
      ['db', 'migrate', '--to', 'db'],
    ]);
    expect(new Set(seen)).toEqual(new Set(['step-42-1', 'step-42-2']));
    expect(deps.written.size).toBe(0);
    expect(deps.logs[0]).toMatch(/^step 1\/3: --to step-42-1 \(8 invariants: /);
  });

  it('an up-to-date database runs one db step and writes no ref', async () => {
    deps.marker = { coreHash: 'C', invariants: dbRef.invariants };
    expect(await runStepped([], input, deps)).toBe(0);
    expect(deps.prismaCalls).toEqual([['db', 'migrate', '--to', 'db']]);
    expect(deps.written.size).toBe(0);
  });

  it('stops at the first failing step and cleans up', async () => {
    deps.failOnCall(2, 1);
    expect(await runStepped([], input, deps)).toBe(1);
    expect(deps.prismaCalls).toHaveLength(2);
    expect(deps.written.size).toBe(0);
  });

  it('cleans up when the runner throws', async () => {
    deps.throwOnCall = 2;
    await expect(runStepped([], input, deps)).rejects.toThrow('spawn failed');
    expect(deps.written.size).toBe(0);
  });

  it('removes only its own step refs', async () => {
    deps.written.set('step-7-1', { hash: 'X', invariants: [] });
    expect(await runStepped([], input, deps)).toBe(0);
    expect([...deps.written.keys()]).toEqual(['step-7-1']);
  });

  it('warns with the node hash for an oversized step and still runs it', async () => {
    const big = names('x', 9);
    const bigInput = {
      edges: [edge(null, 'A', big)],
      dbRef: { hash: 'A', invariants: big },
      runId: '42',
    };
    expect(await runStepped([], bigInput, deps)).toBe(0);
    expect(deps.warnings.some((w) => w.includes('A'))).toBe(true);
    expect(deps.prismaCalls).toEqual([['db', 'migrate', '--to', 'db']]);
  });

  it('reports a StepPlanError as exit 1 without running prisma', async () => {
    const bad = { ...input, dbRef: { hash: 'Z', invariants: [] } };
    expect(await runStepped([], bad, deps)).toBe(1);
    expect(deps.prismaCalls).toEqual([]);
    expect(deps.warnings.length).toBeGreaterThan(0);
  });
});
