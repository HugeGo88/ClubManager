const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentState, paymentStatusLabel } = require('../src/shared/invoice-payments');

test('reports the outstanding balance and payment status of an issued invoice', () => {
  assert.deepEqual(paymentState(10000, [], '2026-12-08', '2026-11-26'),
    { paidCents: 0, remainingCents: 10000, status: 'unpaid', overdue: false });
  assert.deepEqual(paymentState(10000, [{ amountCents: 4000 }], '2026-12-08', '2026-11-26'),
    { paidCents: 4000, remainingCents: 6000, status: 'partial', overdue: false });
  assert.deepEqual(paymentState(10000, [{ amountCents: 4000 }, { amountCents: 6000 }], '2026-12-08', '2026-11-26'),
    { paidCents: 10000, remainingCents: 0, status: 'paid', overdue: false });
});

test('marks only issued invoices with an outstanding balance after the due date as overdue', () => {
  assert.equal(paymentState(10000, [], '2026-11-25', '2026-11-26').overdue, true);
  assert.equal(paymentState(10000, [{ amountCents: 4000 }], '2026-11-25', '2026-11-26').overdue, true);
  assert.equal(paymentState(10000, [], '2026-11-26', '2026-11-26').overdue, false);
  assert.equal(paymentState(10000, [], '2026-11-27', '2026-11-26').overdue, false);
  assert.equal(paymentState(10000, [{ amountCents: 10000 }], '2026-11-25', '2026-11-26').overdue, false);
});

test('labels payment states in German including the overdue state', () => {
  assert.equal(paymentStatusLabel(paymentState(10000, [], '2026-12-08', '2026-11-26')), 'Unbezahlt');
  assert.equal(paymentStatusLabel(paymentState(10000, [{ amountCents: 4000 }], '2026-12-08', '2026-11-26')), 'Teilweise bezahlt');
  assert.equal(paymentStatusLabel(paymentState(10000, [{ amountCents: 10000 }], '2026-11-01', '2026-11-26')), 'Bezahlt');
  assert.equal(paymentStatusLabel(paymentState(10000, [{ amountCents: 4000 }], '2026-11-01', '2026-11-26')), 'Teilweise bezahlt · überfällig');
});
