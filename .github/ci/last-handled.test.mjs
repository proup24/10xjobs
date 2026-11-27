import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSha, pickLastHandled } from './last-handled.mjs';

const ok = { status: 'completed', conclusion: 'success' };

const A = 'a'.repeat(40),
  B = 'b'.repeat(40);
test('extractSha', () => {
  assert.equal(extractSha(`Dev database ${A}`), A);
  assert.equal(extractSha('Deploy engine'), null);
  assert.equal(extractSha(`${A} ${B}`), null);
});
test('newest run whose job succeeded', () => {
  const runs = [
    { id: 3, ...ok, display_title: `x ${A}` },
    { id: 2, ...ok, display_title: `x ${B}` },
  ];
  assert.equal(
    pickLastHandled(runs, (id) => (id === 3 ? 'skipped' : 'success')),
    B,
  );
});
test('an old-format title on the newest successful run gives null', () => {
  assert.equal(
    pickLastHandled(
      [
        { id: 2, ...ok, display_title: 'Deploy engine' },
        { id: 1, ...ok, display_title: `x ${A}` },
      ],
      () => 'success',
    ),
    null,
  );
});
test('no runs gives null', () =>
  assert.equal(
    pickLastHandled([], () => 'success'),
    null,
  ));
test('runs that are not completed successfully are passed over', () => {
  const runs = [
    { id: 4, status: 'in_progress', conclusion: null, display_title: `x ${A}` },
    {
      id: 3,
      status: 'completed',
      conclusion: 'skipped',
      display_title: `x ${A}`,
    },
    {
      id: 2,
      status: 'completed',
      conclusion: 'failure',
      display_title: `x ${A}`,
    },
    {
      id: 1,
      status: 'completed',
      conclusion: 'success',
      display_title: `x ${B}`,
    },
  ];
  assert.equal(
    pickLastHandled(runs, () => 'success'),
    B,
  );
});
