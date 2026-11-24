/**
 * `pnpm db:migrate`: walks the migration history in steps so Prisma's planner
 * never sees more than a few new invariants at once. Takes no arguments.
 */
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import pg from 'pg';
import { loadDatabaseEnvironment } from '../env/database-environment.js';
import { loadDbRef, loadEdges, type Marker } from './plan-steps.js';
import { runStepped, type RunDeps } from './run-stepped.js';

const libDir = path.resolve(__dirname, '../..');
const appDir = path.join(libDir, 'src', 'migrations', 'app');
const refPath = (name: string) => path.join(appDir, 'refs', `${name}.json`);

const { DIRECT_DATABASE_URL, DATABASE_URL } = loadDatabaseEnvironment();
const connectionString = DIRECT_DATABASE_URL ?? DATABASE_URL;

const runId = String(process.pid);
const written = new Set<string>();
let child: ReturnType<typeof spawn> | null = null;

const deps: RunDeps = {
  async readMarker(): Promise<Marker | null> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{
        core_hash: string;
        invariants: string[] | null;
      }>(
        "select core_hash, invariants from prisma_contract.marker where space = 'app'",
      );
      const row = rows[0];
      return row
        ? { coreHash: row.core_hash, invariants: row.invariants ?? [] }
        : null;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01' || code === '3F000') return null;
      throw error;
    } finally {
      await client.end();
    }
  },
  writeRef(name, ref) {
    written.add(name);
    writeFileSync(refPath(name), `${JSON.stringify(ref, null, 2)}\n`);
  },
  removeRef(name) {
    rmSync(refPath(name), { force: true });
    written.delete(name);
  },
  runPrisma(args) {
    return new Promise((resolve, reject) => {
      child = spawn(path.join(libDir, 'node_modules', '.bin', 'prisma'), args, {
        cwd: libDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' },
      });
      child.on('error', reject);
      child.on('close', (code) => {
        child = null;
        resolve(code ?? 1);
      });
    });
  },
  log: (message) => console.log(message),
  warn: (message) => console.error(message),
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    const finish = () => {
      for (const name of [...written]) deps.removeRef(name);
      process.exit(130);
    };
    if (!child) return finish();
    // Wait for Prisma to stop before deleting its step ref and returning.
    child.once('close', finish);
    setTimeout(finish, 10_000).unref();
    child.kill(signal);
  });
}

async function main(): Promise<void> {
  process.exit(
    await runStepped(
      process.argv.slice(2),
      { edges: loadEdges(appDir), dbRef: loadDbRef(appDir), runId },
      deps,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  for (const name of [...written]) deps.removeRef(name);
  process.exit(1);
});
