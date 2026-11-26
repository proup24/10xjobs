import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSha, pickLastHandled } from './last-handled.mjs';

const A = 'a'.repeat(40),
  B = 'b'.repeat(40);
test('extractSha', () => {
  assert.equal(extractSha(`Dev database ${A}`), A);
  assert.equal(extractSha('Deploy engine'), null);
  assert.equal(extractSha(`${A} ${B}`), null);
});
test('newest run whose job succeeded', () => {
  const runs = [
    { id: 3, display_title: `x ${A}` },
    { id: 2, display_title: `x ${B}` },
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
        { id: 2, display_title: 'Deploy engine' },
        { id: 1, display_title: `x ${A}` },
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
