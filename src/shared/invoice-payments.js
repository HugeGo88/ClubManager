(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./dates'));
  else root.invoicePayments = factory(root.clubDates);
})(globalThis, dates => {
  function paymentState(totalCents, payments, dueDate, today = dates.localDate()) {
    const paidCents = (payments || []).reduce((sum, payment) => sum + payment.amountCents, 0);
    const remainingCents = totalCents - paidCents;
    const status = paidCents === 0 ? 'unpaid' : remainingCents === 0 ? 'paid' : 'partial';
    return {
      paidCents,
      remainingCents,
      status,
      overdue: remainingCents > 0 && dates.overdue(dueDate, today)
    };
  }

  function paymentStatusLabel(state) {
    const label = { unpaid: 'Unbezahlt', partial: 'Teilweise bezahlt', paid: 'Bezahlt' }[state.status];
    return state.overdue ? `${label} · überfällig` : label;
  }

  return Object.freeze({ paymentState, paymentStatusLabel });
});
