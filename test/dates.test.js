const test = require('node:test');
const assert = require('node:assert/strict');
const { isDate, localDate, formatDate, overdue } = require('../src/shared/dates');

test('validates calendar dates including leap years', () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '2026-12-31']) assert.ok(isDate(date));
  for (const date of ['2025-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '', null]) assert.equal(isDate(date), false);
});

test('overdue starts after the local due date, not on it', () => {
  assert.equal(overdue('2026-11-09', '2026-11-10'), true);
  assert.equal(overdue('2026-11-10', '2026-11-10'), false);
  assert.equal(overdue('2026-11-11', '2026-11-10'), false);
  assert.equal(overdue(undefined, '2026-11-10'), false);
  assert.equal(localDate(new Date(2026, 10, 10, 23, 59)), '2026-11-10');
  assert.equal(formatDate('2026-11-10'), '10.11.2026');
});
