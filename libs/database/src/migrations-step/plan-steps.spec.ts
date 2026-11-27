import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadDbRef,
  loadEdges,
  planSteps,
  type MigrationEdge,
  type RefFile,
} from './plan-steps.js';

function edge(
  from: string | null,
  to: string,
  provided: string[] = [],
  extra: Partial<MigrationEdge> = {},
): MigrationEdge {
  return {
    dirName: `${from}-${to}`,
    from,
    to,
    providedInvariants: provided,
    createdAt: '2026-01-01T00:00:00.000Z',
    migrationHash: `mh-${from}-${to}`,
    ...extra,
  };
}

const names = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** h0 (null→h0), h1…; `loops[i]` invariants on a loop at h(i), `into[i]` on the edge into h(i). */
function chain(
  length: number,
  into: Record<number, string[]>,
  loops: Record<number, string[]>,
) {
  const edges: MigrationEdge[] = [];
  for (let i = 0; i <= length; i++) {
    edges.push(edge(i === 0 ? null : `h${i - 1}`, `h${i}`, into[i] ?? []));
    if (loops[i]) edges.push(edge(`h${i}`, `h${i}`, loops[i]));
  }
  return edges;
}

function twenty() {
  const loops: Record<number, string[]> = {
    1: names('a', 3),
    2: names('b', 3),
    3: names('c', 3),
    4: names('d', 3),
  };
  const into: Record<number, string[]> = { 5: names('e', 8) };
  const edges = chain(5, into, loops);
  const all = [...Object.values(loops).flat(), ...into[5]];
  return { edges, dbRef: { hash: 'h5', invariants: all } satisfies RefFile };
}

describe('planSteps', () => {
  it('fresh chain is cut into steps of at most 8, cumulative ref invariants', () => {
    const { edges, dbRef } = twenty();
    const steps = planSteps(edges, dbRef, null);
    expect(steps.map((s) => s.newInvariants.length)).toEqual([6, 6, 8]);
    expect((steps[1].target as RefFile).invariants).toHaveLength(12);
    expect(steps[0].node).toBe('h2');
    expect(steps.at(-1)!.target).toBe('db');
    expect(steps.at(-1)!.node).toBe('h5');
  });

  it('marker partway starts at its node and leaves out its invariants', () => {
    const { edges, dbRef } = twenty();
    const marker = {
      coreHash: 'h2',
      invariants: [...names('a', 3), ...names('b', 3)],
    };
    const steps = planSteps(edges, dbRef, marker);
    for (const s of steps) {
      expect(
        s.newInvariants.filter((i) => marker.invariants.includes(i)),
      ).toEqual([]);
    }
    expect(steps.flatMap((s) => s.newInvariants).sort()).toEqual(
      [...names('c', 3), ...names('d', 3), ...names('e', 8)].sort(),
    );
    for (const s of steps) expect(['h0', 'h1']).not.toContain(s.node);
  });

  it('marker at head with a missing loop invariant gives one db step', () => {
    const edges = chain(2, {}, { 2: ['x', 'y'] });
    const dbRef = { hash: 'h2', invariants: ['x', 'y'] };
    expect(
      planSteps(edges, dbRef, { coreHash: 'h2', invariants: ['x'] }),
    ).toEqual([
      { target: 'db', node: 'h2', newInvariants: ['y'], oversized: false },
    ]);
  });

  it('marker at head with every invariant gives one db step with nothing new', () => {
    const edges = chain(2, {}, { 2: ['x'] });
    const dbRef = { hash: 'h2', invariants: ['x'] };
    expect(
      planSteps(edges, dbRef, { coreHash: 'h2', invariants: ['x'] }),
    ).toEqual([
      { target: 'db', node: 'h2', newInvariants: [], oversized: false },
    ]);
  });

  it('stops on a fork where both branches reach the db ref', () => {
    const edges = [
      edge(null, 'h0'),
      edge('h0', 'aa', [], { dirName: 'dirA' }),
      edge('aa', 'head'),
      edge('h0', 'bb', [], { dirName: 'dirB' }),
      edge('bb', 'head'),
    ];
    expect(() =>
      planSteps(edges, { hash: 'head', invariants: [] }, null),
    ).toThrow(/Fork at h0: dirA and dirB both reach the db ref/);
  });

  it('never routes into a dead-end branch', () => {
    const edges = [
      edge(null, 'h0'),
      edge('h0', 'dead', ['dead-inv'], { createdAt: '2026-01-01T00:00:00Z' }),
      edge('h0', 'h1', ['ok'], { createdAt: '2026-01-02T00:00:00Z' }),
    ];
    const steps = planSteps(edges, { hash: 'h1', invariants: ['ok'] }, null);
    expect(steps.map((s) => s.node)).toEqual(['h1']);
    expect(steps.flatMap((s) => s.newInvariants)).toEqual(['ok']);
  });

  it('a node with more than 8 due invariants is one oversized step', () => {
    const edges = chain(3, { 2: names('big', 9) }, { 1: ['p'], 3: ['q'] });
    const dbRef = { hash: 'h3', invariants: ['p', ...names('big', 9), 'q'] };
    const steps = planSteps(edges, dbRef, null);
    expect(steps.find((s) => s.oversized)?.newInvariants).toHaveLength(9);
    expect(steps.map((s) => s.newInvariants.length)).toEqual([1, 9, 1]);
    expect(steps.at(-1)!.target).toBe('db');
  });

  it('throws when the marker hash is off the route', () => {
    const { edges, dbRef } = twenty();
    expect(() =>
      planSteps(edges, dbRef, { coreHash: 'feedface', invariants: [] }),
    ).toThrow(/feedface.*db:reset/);
  });

  it('throws when a ref invariant is provided nowhere on the route', () => {
    const { edges, dbRef } = twenty();
    expect(() =>
      planSteps(
        edges,
        { ...dbRef, invariants: [...dbRef.invariants, 'nope'] },
        null,
      ),
    ).toThrow(/nope/);
  });
});

describe('real history', () => {
  const appDir = path.resolve(__dirname, '../migrations/app');

  it('real history from empty: every step ≤ 8, last is db, all 48 covered', () => {
    const edges = loadEdges(appDir);
    const dbRef = loadDbRef(appDir);
    const steps = planSteps(edges, dbRef, null);
    expect(dbRef.invariants).toHaveLength(48);
    expect(steps.some((s) => s.oversized)).toBe(false);
    for (const s of steps)
      expect(s.newInvariants.length).toBeLessThanOrEqual(8);
    expect(steps.at(-1)!.target).toBe('db');
    expect(steps.at(-1)!.node).toBe(dbRef.hash);
    expect(steps.flatMap((s) => s.newInvariants).sort()).toEqual(
      [...dbRef.invariants].sort(),
    );
    expect(steps.map((s) => s.node).some((n) => n.startsWith('f0cc0f'))).toBe(
      false,
    );
  });
});
