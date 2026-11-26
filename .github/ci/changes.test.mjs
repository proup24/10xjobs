import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, findGaps, packageJsonOtherFieldsChanged } from './changes.mjs';

const none = { all: false, changedFiles: [], affected: [], packageJsonOtherFieldsChanged: false };
test('empty diff runs nothing', () => {
  assert.deepEqual(decide(none).jobs, { main: false, database: false, e2e: false, hooks: false, migrate: false, deploy: false });
});
test('engine change', () => {
  const { jobs } = decide({ ...none, changedFiles: ['apps/xjobs/src/main.ts'], affected: ['@xjobs/xjobs', '@xjobs/xjobs-e2e'] });
  assert.deepEqual(jobs, { main: true, database: false, e2e: true, hooks: false, migrate: false, deploy: true });
});
test('database lib change runs database, migrate and everything downstream', () => {
  const { jobs } = decide({ ...none, changedFiles: ['libs/database/src/x.ts'], affected: ['@xjobs/database', '@xjobs/db-tests', '@xjobs/xjobs', '@xjobs/xjobs-e2e', 'web'] });
  assert.equal(jobs.database && jobs.migrate && jobs.deploy && jobs.e2e, true);
});
test('web only', () => {
  const { jobs } = decide({ ...none, changedFiles: ['apps/web/src/a.tsx'], affected: ['web'] });
  assert.deepEqual(jobs, { main: true, database: false, e2e: false, hooks: false, migrate: false, deploy: false });
});
test('hooks', () => assert.equal(decide({ ...none, changedFiles: ['.claude/hooks/guard.mjs'] }).jobs.hooks, true));
test('--all', () => assert.equal(Object.values(decide({ ...none, all: true }).jobs).every(Boolean), true));
test('packageManager plus a web file runs everything', () => {
  const r = decide({ ...none, changedFiles: ['package.json', 'apps/web/a.tsx'], affected: ['web'], packageJsonOtherFieldsChanged: true });
  assert.equal(Object.values(r.jobs).every(Boolean), true);
  assert.match(r.runAllReason, /package\.json/);
});
test('pnpm-workspace.yaml always runs everything', () => {
  assert.equal(Object.values(decide({ ...none, changedFiles: ['pnpm-workspace.yaml'], affected: ['@xjobs/xjobs'] }).jobs).every(Boolean), true);
});
test('lockfile with nothing affected runs everything', () => {
  assert.equal(Object.values(decide({ ...none, changedFiles: ['pnpm-lock.yaml'] }).jobs).every(Boolean), true);
});
test('lockfile narrowed to web stays web', () => {
  assert.equal(decide({ ...none, changedFiles: ['pnpm-lock.yaml'], affected: ['web'] }).jobs.deploy, false);
});
test('packageJsonOtherFieldsChanged', () => {
  assert.equal(packageJsonOtherFieldsChanged({ packageManager: 'pnpm@1', dependencies: { a: '1' } }, { packageManager: 'pnpm@1', dependencies: { a: '2' } }), false);
  assert.equal(packageJsonOtherFieldsChanged({ packageManager: 'pnpm@1' }, { packageManager: 'pnpm@2' }), true);
  assert.equal(packageJsonOtherFieldsChanged({ scripts: { t: 'a' } }, { scripts: { t: 'b' } }), true);
  assert.equal(packageJsonOtherFieldsChanged(null, {}), true);
});
const roots = ['apps/xjobs', 'apps/web', 'libs/database'];
const ignore = JSON.parse(readFileSync(new URL('./runs-nothing.json', import.meta.url)));
test('gaps: project files, ignored files, hooks and dependency files are covered', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['apps/xjobs/a.ts', 'docs/x.md', 'README.md', '.claude/settings.json', '.claude/hooks/guard.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.tsbuildinfo', '.pnpm-store/v11/index.db'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: () => false }), []);
});
test('gaps: an unowned root file is a gap; an owned one is not', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['newtool.config.js', 'supabase/config.toml'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: (f) => f.startsWith('supabase/') }), ['newtool.config.js']);
});
test('gaps: a project root prefix needs a slash', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['apps/xjobs-old/a.ts'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: () => false }), ['apps/xjobs-old/a.ts']);
});
