(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.invoiceAmounts = factory();
})(globalThis, () => {
  const maxCents = BigInt(Number.MAX_SAFE_INTEGER);
  class InvoiceAmountError extends Error {}

  function parseEuroPrice(value) {
    if (typeof value !== 'string' || !/^\d+(?:[,.]\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split(/[,.]/);
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return cents <= maxCents ? Number(cents) : null;
  }

  function parseQuantity(value) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) {
      if (typeof value === 'string' && /^\d+\.\d{4,}$/.test(value)) {
        throw new InvoiceAmountError('Die Menge darf höchstens drei Nachkommastellen haben.');
      }
      throw new InvoiceAmountError('Die Menge muss eine positive Zahl mit höchstens drei Nachkommastellen sein.');
    }
    const [whole, fraction = ''] = value.split('.');
    const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
    if (milli <= 0n) throw new InvoiceAmountError('Die Menge muss eine positive Menge sein.');
    return milli;
  }

  function calculateInvoiceTotal(items) {
    let total = 0n;
    const itemsCents = items.map(item => {
      if (!item || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
        throw new InvoiceAmountError('Der Einzelpreis muss ein nicht negativer Eurobetrag mit höchstens zwei Nachkommastellen sein.');
      }
      const cents = (parseQuantity(item.quantity) * BigInt(item.unitPriceCents) + 500n) / 1000n;
      total += cents;
      if (cents > maxCents || total > maxCents) throw new InvoiceAmountError('Der Rechnungsbetrag ist zu groß.');
      return Number(cents);
    });
    return { cents: Number(total), itemsCents };
  }

  function formatCents(cents) {
    return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
  }

  return Object.freeze({ InvoiceAmountError, parseEuroPrice, parseQuantity, calculateInvoiceTotal, formatCents });
});
