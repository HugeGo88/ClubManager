const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRelease } = require('../scripts/prepare-release.cjs');

const current = { version: '0.1.4' };
const lock = { version: '0.1.4', packages: { '': { version: '0.1.4' } } };
const changelog = [{ version: '0.1.4', changes: ['Neue Funktion hinzugefügt.'] }];

test('only releases on push when the package version changes', () => {
  assert.equal(evaluateRelease('push', current, { version: '0.1.3' }, lock, changelog), true);
  assert.equal(evaluateRelease('push', current, current, lock, changelog), false);
  assert.throws(() => evaluateRelease('push', current, {}, lock, changelog), /previous package\.json/);
});

test('manual runs validate even when the version has not changed', () => {
  assert.equal(evaluateRelease('workflow_dispatch', current, null, lock, changelog), true);
  assert.throws(() => evaluateRelease('workflow_dispatch', current, null, lock, []), /release notes/);
  assert.throws(() => evaluateRelease('other', current, null, lock, changelog), /Unsupported release event/);
});

test('rejects invalid versions and mismatched lockfile versions', () => {
  assert.throws(() => evaluateRelease('workflow_dispatch', { version: '0.1.4-beta' }, null, lock, changelog), /stable version/);
  assert.throws(() => evaluateRelease('workflow_dispatch', current, null, { ...lock, version: '0.1.3' }, changelog), /package-lock\.json/);
  assert.throws(() => evaluateRelease('workflow_dispatch', current, null, { ...lock, packages: { '': { version: '0.1.3' } } }, changelog), /package-lock\.json/);
});

test('requires a nonempty changelog entry for the release version', () => {
  for (const entries of [[], [{ version: '0.1.3', changes: ['Alt'] }],
    [{ version: '0.1.4', changes: [] }], [{ version: '0.1.4', changes: ['  '] }],
    [{ version: '0.1.4', changes: [null] }]]) {
    assert.throws(() => evaluateRelease('workflow_dispatch', current, null, lock, entries), /release notes/);
  }
});
