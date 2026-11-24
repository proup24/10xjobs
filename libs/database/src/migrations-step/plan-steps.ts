import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export const STEP_INVARIANT_CAP = 8;

export interface MigrationEdge {
  dirName: string;
  from: string | null; // null only for the first migration (empty database)
  to: string;
  providedInvariants: string[];
  createdAt: string;
  migrationHash: string;
}

export interface RefFile {
  hash: string;
  invariants: string[];
}

export interface Marker {
  coreHash: string;
  invariants: string[];
}

export interface Step {
  target: 'db' | RefFile; // 'db' only for the last step
  node: string; // the hash the step ends at
  newInvariants: string[]; // required invariants this step collects
  oversized: boolean; // newInvariants.length > STEP_INVARIANT_CAP
}

export class StepPlanError extends Error {}

/** Reads every migration folder under `appDir` except `refs`. */
export function loadEdges(appDir: string): MigrationEdge[] {
  return readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'refs')
    .map((d) => {
      const raw = JSON.parse(
        readFileSync(path.join(appDir, d.name, 'migration.json'), 'utf8'),
      );
      return {
        dirName: d.name,
        from: raw.from ?? null,
        to: raw.to,
        providedInvariants: raw.providedInvariants ?? [],
        createdAt: raw.createdAt,
        migrationHash: raw.migrationHash,
      } satisfies MigrationEdge;
    });
}

export function loadDbRef(appDir: string): RefFile {
  const raw = JSON.parse(
    readFileSync(path.join(appDir, 'refs', 'db.json'), 'utf8'),
  );
  return { hash: raw.hash, invariants: raw.invariants ?? [] };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compareTieBreak(a: MigrationEdge, b: MigrationEdge): number {
  return (
    cmp(a.createdAt, b.createdAt) ||
    cmp(a.to, b.to) ||
    cmp(a.migrationHash, b.migrationHash)
  );
}

export function planSteps(
  edges: MigrationEdge[],
  dbRef: RefFile,
  marker: Marker | null,
): Step[] {
  const start = marker?.coreHash ?? null;
  const hasMarker = new Set(marker?.invariants ?? []);
  const required = new Set(dbRef.invariants.filter((i) => !hasMarker.has(i)));

  const outgoing = new Map<string | null, MigrationEdge[]>();
  for (const e of [...edges]
    .filter((x) => x.from !== x.to)
    .sort(compareTieBreak)) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  // BFS: first discovery of a node wins, edges are visited in tie-break order.
  const via = new Map<string, MigrationEdge>();
  const seen = new Set<string | null>([start]);
  const queue: (string | null)[] = [start];
  while (queue.length > 0 && !seen.has(dbRef.hash)) {
    const node = queue.shift()!;
    for (const e of outgoing.get(node) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      via.set(e.to, e);
      queue.push(e.to);
    }
  }
  if (start !== dbRef.hash && !via.has(dbRef.hash)) {
    throw new StepPlanError(
      start === null
        ? `No migration route from an empty database to ${dbRef.hash}`
        : `Database is at ${start}, which has no route to ${dbRef.hash}; run pnpm db:reset`,
    );
  }

  const route: MigrationEdge[] = [];
  for (let n: string = dbRef.hash; n !== start; ) {
    const e = via.get(n)!;
    route.unshift(e);
    n = e.from as string;
  }

  const loopsAt = (node: string | null) =>
    edges
      .filter((e) => e.from === node && e.to === node)
      .flatMap((e) => e.providedInvariants);
  const nodes: { node: string | null; due: string[] }[] = [
    { node: start, due: loopsAt(start) },
    ...route.map((e) => ({
      node: e.to,
      due: [...e.providedInvariants, ...loopsAt(e.to)],
    })),
  ];

  const collected = new Set<string>();
  const steps: Step[] = [];
  let current: string[] = [];
  let prev: string | null = null;
  const close = (
    node: string,
    newInvariants: string[],
    target: Step['target'],
  ) =>
    steps.push({
      target,
      node,
      newInvariants,
      oversized: newInvariants.length > STEP_INVARIANT_CAP,
    });

  for (const { node, due } of nodes) {
    const fresh = [...new Set(due)].filter(
      (i) => required.has(i) && !collected.has(i),
    );
    if (
      current.length > 0 &&
      current.length + fresh.length > STEP_INVARIANT_CAP
    ) {
      close(prev as string, current, {
        hash: prev as string,
        invariants: [...collected],
      });
      current = [];
      // `collected` above already includes only invariants due up to prev.
    }
    for (const i of fresh) collected.add(i);
    current.push(...fresh);
    prev = node;
  }

  for (const i of required) {
    if (!collected.has(i)) {
      throw new StepPlanError(
        `Invariant ${i} is not provided by any migration on the route to ${dbRef.hash}`,
      );
    }
  }
  close(dbRef.hash, current, 'db');
  return steps;
}
