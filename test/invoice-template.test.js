const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateInvoiceTemplate } = require('../src/main/invoices');
const {
  customizationPath,
  importCustomization,
  resetCustomization
} = require('../src/main/document-customizations');

const requiredPlaceholders = [
  'invoice_number',
  'issuer_name',
  'issuer_address',
  'issuer_identifier',
  'recipient_name',
  'recipient_address',
  'invoice_date',
  'service_details',
  'due_date',
  'items',
  'total',
  'bank_name',
  'iban',
  'girocode'
];

function template(content = requiredPlaceholders.map(key => `{{${key}}}`).join(' ')) {
  return `<main>${content}</main>`;
}

test('validates required invoice fields only when usable template text contains their placeholders', () => {
  assert.doesNotThrow(() => validateInvoiceTemplate(template()));
  assert.doesNotThrow(() => validateInvoiceTemplate(template(
    requiredPlaceholders.map(key => `{{${key}}}`).join(' '))));

  for (const invalid of [
    template('{{unknown}}'),
    template(requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')),
    template(`${requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')}<!-- {{total}} -->`),
    template(`${requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')}<span hidden>{{total}}</span>`),
    template(`${requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')}<script>{{total}}</script>`),
    template(`${requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')}<p onclick="run()">{{total}}</p>`),
    template(`${requiredPlaceholders.filter(key => key !== 'total').map(key => `{{${key}}}`).join(' ')}<iframe>{{total}}</iframe>`)
  ]) {
    assert.throws(() => validateInvoiceTemplate(invalid), /vorlage|platzhalter|skript|sichtbar|versteckt|ausführbar/i);
  }
});

test('packaged invoice template includes all required visible placeholders', async () => {
  const packaged = await fs.readFile(path.join(__dirname, '../src/shared/invoice.html'), 'utf8');
  assert.doesNotThrow(() => validateInvoiceTemplate(packaged));
});

test('imports and resets invoice templates independently in each data folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-template-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const source = path.join(root, 'invoice.html');
  const content = template();
  await Promise.all([fs.mkdir(first), fs.mkdir(second), fs.writeFile(source, content)]);

  const imported = await importCustomization(first, 'invoiceTemplate', source, validateInvoiceTemplate);

  assert.equal(imported, path.join(first, 'customizations', 'invoice.html'));
  assert.equal(await fs.readFile(imported, 'utf8'), content);
  assert.equal(await customizationPath(second, 'invoiceTemplate'), null);
  await resetCustomization(first, 'invoiceTemplate');
  assert.equal(await customizationPath(first, 'invoiceTemplate'), null);
});
