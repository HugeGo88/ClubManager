const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { initializeFolder } = require('../src/main/storage');
const { parseEuroPrice } = require('../src/shared/invoice-amounts');
const {
  calculateInvoiceTotal,
  validateInvoiceDraft,
  saveInvoice,
  listInvoices,
  invoiceHtml,
  loadInvoiceSettings,
  saveInvoiceSettings
} = require('../src/main/invoices');

function draft(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    invoiceDate: '2026-11-24',
    serviceDate: '2026-11-20',
    servicePeriodStart: '',
    servicePeriodEnd: '',
    dueDate: '2026-12-08',
    recipient: {
      name: 'Alex & Sam',
      company: '<Beispiel>',
      street: 'Musterstraße 1',
      postalCode: '01234',
      city: 'Musterstadt'
    },
    items: [
      { description: 'Erste Leistung', quantity: '0.125', unit: 'Stunde', unitPriceCents: 4 },
      { description: 'Kostenlose Position', quantity: '1', unit: 'Stück', unitPriceCents: 0 }
    ],
    ...overrides
  };
}

test('accepts euro prices exactly in cents and rejects invalid precision and signs', () => {
  for (const [input, cents] of [['3,50', 350], ['3.5', 350], ['0,04', 4], ['0', 0], ['12,', null]]) {
    assert.equal(parseEuroPrice(input), cents);
  }
  for (const input of ['', '-1,00', '1,001', '1e2', '90071992547409,92']) {
    assert.equal(parseEuroPrice(input), null);
  }
});

test('rounds each invoice position half-up before summing the cent total', () => {
  assert.deepEqual(calculateInvoiceTotal([
    { quantity: '0.125', unitPriceCents: 4 },
    { quantity: '0.125', unitPriceCents: 4 }
  ]), { cents: 2, itemsCents: [1, 1] });
  assert.deepEqual(calculateInvoiceTotal([
    { quantity: '1', unitPriceCents: 0 },
    { quantity: '1.5', unitPriceCents: 50 }
  ]), { cents: 75, itemsCents: [0, 75] });
  assert.throws(() => calculateInvoiceTotal([
    { quantity: '2', unitPriceCents: Number.MAX_SAFE_INTEGER }
  ]), /Rechnungsbetrag ist zu groß/);
  assert.throws(() => calculateInvoiceTotal([
    { quantity: '1', unitPriceCents: Number.MAX_SAFE_INTEGER },
    { quantity: '1', unitPriceCents: 1 }
  ]), /Rechnungsbetrag ist zu groß/);
});

test('rejects invalid invoice amounts and precision with German errors', () => {
  assert.throws(() => validateInvoiceDraft(draft({
    items: [{ description: 'Ungültig', quantity: '0', unit: 'Stück', unitPriceCents: 100 }]
  })), /positive Menge/);
  assert.throws(() => validateInvoiceDraft(draft({
    items: [{ description: 'Ungültig', quantity: '1.0001', unit: 'Stück', unitPriceCents: 100 }]
  })), /höchstens drei Nachkommastellen/);
  assert.throws(() => validateInvoiceDraft(draft({
    items: [{ description: 'Ungültig', quantity: '1', unit: 'Stück', unitPriceCents: -1 }]
  })), /nicht negativ/);
  assert.throws(() => validateInvoiceDraft(draft({
    items: [{ description: 'Kostenlos', quantity: '1', unit: 'Stück', unitPriceCents: 0 }]
  })), /positive Gesamtsumme/);
});

test('rejects incomplete invoice drafts before saving', () => {
  assert.throws(() => validateInvoiceDraft(draft({
    recipient: { name: '', company: '', street: '', postalCode: '', city: '' }
  })), /Empfängername/);
  assert.throws(() => validateInvoiceDraft(draft({ dueDate: '' })), /Fälligkeitsdatum/);
  assert.throws(() => validateInvoiceDraft(draft({
    items: [{ description: '', quantity: '1', unit: 'Stück', unitPriceCents: 100 }]
  })), /Rechnungsposition/);
});

test('stores invoice settings per folder and detects settings conflicts', async t => {
  const first = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-settings-'));
  const second = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-settings-'));
  t.after(() => Promise.all([
    fs.rm(first, { recursive: true, force: true }),
    fs.rm(second, { recursive: true, force: true })
  ]));
  await initializeFolder(first);
  await initializeFolder(second);
  const initial = await loadInvoiceSettings(first);
  assert.equal(initial.settings.paymentDays, 14);
  assert.deepEqual((await loadInvoiceSettings(second)).settings, initial.settings);
  const saved = await saveInvoiceSettings(first, {
    issuerName: 'Club',
    issuerAddress: 'Hauptstraße 1',
    bankName: 'Bank',
    iban: 'DE00',
    bic: 'BANKDE',
    paymentDays: 21
  }, initial.revision);
  assert.equal(saved.settings.paymentDays, 21);
  await assert.rejects(saveInvoiceSettings(first, saved.settings, initial.revision), /geändert/);
  assert.equal((await loadInvoiceSettings(second)).settings.paymentDays, 14);
});

test('saves and lists folder-local invoice drafts and detects conflicts', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, settings.settings, settings.revision);
  const value = draft();
  const revision = await saveInvoice(folder, value, null);
  assert.deepEqual(await listInvoices(folder), [{ invoice: value, revision }]);
  await assert.rejects(saveInvoice(folder, value, null), /Rechnung wurde auf dem Datenträger geändert/);
  await fs.unlink(path.join(folder, 'invoices', `${value.id}.json`));
  await assert.rejects(saveInvoice(folder, value, revision), /Rechnung wurde auf dem Datenträger geändert/);
});

test('renders rounded position amounts and their total in the invoice document', () => {
  const value = draft({
    items: [
      { description: 'Erste', quantity: '0.125', unit: 'Stunde', unitPriceCents: 4 },
      { description: 'Zweite', quantity: '0.125', unit: 'Stunde', unitPriceCents: 4 }
    ]
  });
  const settings = { issuerName: '', issuerAddress: '', bankName: '', iban: '', bic: '' };
  const html = invoiceHtml(value, settings);
  assert.match(html, /Erste<\/td><td>0\.125<\/td><td>Stunde<\/td><td>0,04 €<\/td><td>0,01 €/);
  assert.match(html, /Zweite<\/td><td>0\.125<\/td><td>Stunde<\/td><td>0,04 €<\/td><td>0,01 €/);
  assert.match(html, /Gesamtsumme: 0,02 €/);
});

test('renders invoice user values as escaped text and never executable markup', () => {
  const html = invoiceHtml(draft({ recipient: {
    name: '<script>bad()</script>',
    company: 'Verein & Team',
    street: 'Straße 1',
    postalCode: '12345',
    city: 'Stadt'
  } }), {
    issuerName: 'Club <Admin>',
    issuerAddress: 'Hauptstraße 1\n12345 Stadt',
    bankName: 'Bank & Co',
    iban: 'DE00',
    bic: 'BANKDE',
    paymentDays: 14
  });
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /Club &lt;Admin&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
