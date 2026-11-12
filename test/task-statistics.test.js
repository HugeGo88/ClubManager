const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/shared/task-statistics');

const record = (date, tasks) => ({ meeting: { date, points: [{ tasks }] } });
const task = (done, extra = {}) => ({ description: '', responsible: '', done, ...extra });

test('builds an estimated end-of-day trend and current task totals', () => {
  const result = summarize([
    record('2026-01-03', [task(false, { dueDate: '2026-01-09' }), task(true, { completedDate: '2026-01-08' })]),
    record('2026-01-05', [task(false), task(true, { completedDate: '2026-01-05' })]),
    record('2026-01-03', [task(true, { completedDate: '2026-01-08' })])
  ], '2026-01-10');
  assert.deepEqual(result, { open: 2, completed: 3, overdue: 1, included: 5, excluded: 0, points: [
    { date: '2026-01-03', open: 3 }, { date: '2026-01-05', open: 4 },
    { date: '2026-01-08', open: 2 }, { date: '2026-01-10', open: 2 }
  ] });
});

test('excludes missing, invalid, future or inconsistent dates from trend but not totals', () => {
  const result = summarize([
    record('', [task(false)]),
    record('invalid', [task(true, { completedDate: '2026-01-04' })]),
    record('2026-01-11', [task(false)]),
    record('2026-01-05', [
      task(true), task(true, { completedDate: '2026-01-04' }),
      task(true, { completedDate: '2026-01-11' }), task(false)
    ])
  ], '2026-01-10');
  assert.deepEqual(result, { open: 3, completed: 4, overdue: 0, included: 1, excluded: 6, points: [
    { date: '2026-01-05', open: 1 }, { date: '2026-01-10', open: 1 }
  ] });
});

test('handles empty, same-day and zero-open trends without duplicate today', () => {
  assert.deepEqual(summarize([], '2026-01-10'), { open: 0, completed: 0, overdue: 0, included: 0, excluded: 0, points: [] });
  assert.deepEqual(summarize([record('2026-01-10', [
    task(true, { completedDate: '2026-01-10' })
  ])], '2026-01-10').points, [{ date: '2026-01-10', open: 0 }]);
  assert.throws(() => summarize([], 'invalid'), /Ungültiges Statistikdatum/);
});
