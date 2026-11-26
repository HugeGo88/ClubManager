const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { initializeFolder } = require('../src/main/storage');
const { parseEuroPrice } = require('../src/shared/invoice-amounts');
const {
  calculateInvoiceTotal,
  validateInvoiceDraft,
  saveInvoice,
  listInvoices,
  invoiceHtml,
  loadInvoiceSettings,
  saveInvoiceSettings,
  issueInvoice,
  redesignInvoice,
  readInvoicePdf
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

test('stores an annual invoice number prefix and starting value per folder', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-number-settings-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);

  const initial = await loadInvoiceSettings(folder);
  assert.equal(initial.settings.invoicePrefix, 'RE');
  assert.equal(initial.settings.invoiceStartNumber, 1);
  const saved = await saveInvoiceSettings(folder, {
    ...initial.settings,
    invoicePrefix: 'RG',
    invoiceStartNumber: 42
  }, initial.revision);
  assert.equal(saved.settings.invoicePrefix, 'RG');
  assert.equal(saved.settings.invoiceStartNumber, 42);
  assert.deepEqual((await loadInvoiceSettings(folder)).settings, saved.settings);

  await assert.rejects(saveInvoiceSettings(folder, {
    ...saved.settings,
    invoicePrefix: 'RE-2026'
  }, saved.revision), /Präfix/);
  await assert.rejects(saveInvoiceSettings(folder, {
    ...saved.settings,
    invoiceStartNumber: 0
  }, saved.revision), /Startwert/);
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

test('issues concurrent saved drafts with unique invoice numbers and locks their contents', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-issued-invoice-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerAddress: 'Vereinsweg 1\n12345 Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX'
  }, settings.revision);
  const firstDraft = draft();
  const secondDraft = draft({ invoiceDate: '2027-01-03' });
  const firstRevision = await saveInvoice(folder, firstDraft, null);
  const secondRevision = await saveInvoice(folder, secondDraft, null);
  const artifacts = new Map([
    [firstDraft.id, { pdf: Buffer.from('%PDF-first'), xml: '<Invoice>first</Invoice>' }],
    [secondDraft.id, { pdf: Buffer.from('%PDF-second'), xml: '<Invoice>second</Invoice>' }]
  ]);
  const generateArtifact = async snapshot => artifacts.get(snapshot.invoice.id);

  const [first, second] = await Promise.all([
    issueInvoice(folder, firstDraft.id, firstRevision, generateArtifact),
    issueInvoice(folder, secondDraft.id, secondRevision, generateArtifact)
  ]);

  assert.equal(first.issued.number, 'RE-2026-0001');
  assert.equal(second.issued.number, 'RE-2027-0001');
  assert.deepEqual(await readInvoicePdf(folder, firstDraft.id), artifacts.get(firstDraft.id).pdf);
  assert.deepEqual(await readInvoicePdf(folder, secondDraft.id), artifacts.get(secondDraft.id).pdf);
  assert.equal((await listInvoices(folder)).find(item => item.invoice.id === firstDraft.id).issued.number, 'RE-2026-0001');
  await assert.rejects(saveInvoice(folder, firstDraft, first.revision), /ausgestellt/);
  await assert.rejects(issueInvoice(folder, firstDraft.id, first.revision, generateArtifact), /ausgestellt/);
});

test('prevents two processes from issuing the same saved invoice', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-concurrent-invoice-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerAddress: 'Vereinsweg 1\n12345 Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX'
  }, settings.revision);
  const value = draft();
  const revision = await saveInvoice(folder, value, null);
  const modulePath = path.join(__dirname, '../src/main/invoices.js');
  const childScript = `
    const { issueInvoice } = require(${JSON.stringify(modulePath)});
    const [folder, id, revision] = process.argv.slice(1);
    issueInvoice(folder, id, revision, async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { pdf: Buffer.from('%PDF-concurrent'), xml: '<Invoice />' };
    }).then(result => console.log(JSON.stringify({ success: true, number: result.issued.number })),
      error => console.log(JSON.stringify({ success: false, error: error.message })));
  `;
  const issueInChild = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', childScript, folder, value.id, revision]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(stderr || `Invoice worker exited with ${code}`));
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Invalid invoice worker result: ${stdout} ${stderr}`, { cause: error }));
      }
    });
  });

  const results = await Promise.all([issueInChild(), issueInChild()]);
  assert.equal(results.filter(result => result.success).length, 1);
  assert.equal(results.filter(result => !result.success).length, 1);
  assert.match(results.find(result => !result.success).error, /wird gerade|bereits ausgestellt/);
  const issued = (await listInvoices(folder)).find(item => item.invoice.id === value.id);
  assert.ok(issued.issued);
  assert.deepEqual(await readInvoicePdf(folder, value.id), Buffer.from('%PDF-concurrent'));
  assert.equal((await fs.readdir(path.join(folder, 'invoices', 'numbers'))).length, 1);
});

test('keeps a draft editable and releases its number when artifact creation fails', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-failed-invoice-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerAddress: 'Vereinsweg 1\n12345 Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX'
  }, settings.revision);
  const value = draft();
  const revision = await saveInvoice(folder, value, null);

  await assert.rejects(issueInvoice(folder, value.id, revision, async () => {
    throw new Error('PDF/A validation failed');
  }), /PDF\/A validation failed/);
  assert.deepEqual((await listInvoices(folder)).map(item => item.invoice), [value]);
  await assert.rejects(readInvoicePdf(folder, value.id), /noch kein ausgestelltes PDF/);

  const issued = await issueInvoice(folder, value.id, revision, async () => ({
    pdf: Buffer.from('%PDF-retry'),
    xml: '<Invoice />'
  }));
  assert.equal(issued.issued.number, 'RE-2026-0001');
  assert.deepEqual(await readInvoicePdf(folder, value.id), Buffer.from('%PDF-retry'));
});

test('stores selectable PDF revisions without changing issued invoice facts', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-redesign-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerStreet: 'Vereinsweg 1',
    issuerPostalCode: '12345',
    issuerCity: 'Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX'
  }, settings.revision);
  const value = draft();
  const draftRevision = await saveInvoice(folder, value, null);
  const xml = '<Invoice>frozen facts</Invoice>';
  const initialPdf = Buffer.from('%PDF-layout-one');
  const issued = await issueInvoice(folder, value.id, draftRevision, async () => ({ pdf: initialPdf, xml }));

  const updatedPdf = Buffer.from('%PDF-layout-two');
  const redesigned = await redesignInvoice(folder, value.id, issued.revision, async snapshot => {
    assert.deepEqual(snapshot, issued.issued.snapshot);
    return { pdf: updatedPdf, xml };
  });
  const record = (await listInvoices(folder)).find(item => item.invoice.id === value.id);
  const revisions = record.issued.pdfRevisions;

  assert.equal(redesigned.issued.number, issued.issued.number);
  assert.equal(redesigned.issued.xmlRevision, issued.issued.xmlRevision);
  assert.deepEqual(record.invoice, value);
  assert.equal(revisions.length, 2);
  assert.notEqual(revisions[0].id, revisions[1].id);
  assert.deepEqual(await readInvoicePdf(folder, value.id), updatedPdf);
  assert.deepEqual(await readInvoicePdf(folder, value.id, revisions[0].id), initialPdf);
  assert.deepEqual(await readInvoicePdf(folder, value.id, revisions[1].id), updatedPdf);
  await assert.rejects(redesignInvoice(folder, value.id, issued.revision, async () => ({
    pdf: Buffer.from('%PDF-stale'),
    xml
  })), /geändert/);
  assert.deepEqual(await readInvoicePdf(folder, value.id), updatedPdf);
  assert.deepEqual((await listInvoices(folder)).find(item => item.invoice.id === value.id).issued.pdfRevisions, revisions);
});

test('reads legacy issued invoices as a single initial PDF revision', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-legacy-invoice-revision-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerStreet: 'Vereinsweg 1',
    issuerPostalCode: '12345',
    issuerCity: 'Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000'
  }, settings.revision);
  const value = draft();
  const draftRevision = await saveInvoice(folder, value, null);
  const pdf = Buffer.from('%PDF-legacy');
  const issued = await issueInvoice(folder, value.id, draftRevision, async () => ({
    pdf,
    xml: '<Invoice />'
  }));
  const file = path.join(folder, 'invoices', `${value.id}.json`);
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  delete record.issued.pdfRevisions;
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`);

  const listed = (await listInvoices(folder)).find(item => item.invoice.id === value.id);
  assert.deepEqual(listed.issued.pdfRevisions, [{
    id: 'initial',
    pdfRevision: issued.issued.pdfRevision,
    createdAt: issued.issued.issuedAt
  }]);
  assert.deepEqual(await readInvoicePdf(folder, value.id, 'initial'), pdf);
});

test('failed invoice redesign preserves the current and previous PDF revisions', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-failed-invoice-redesign-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const settings = await loadInvoiceSettings(folder);
  await saveInvoiceSettings(folder, {
    ...settings.settings,
    issuerName: 'Beispielverein',
    issuerStreet: 'Vereinsweg 1',
    issuerPostalCode: '12345',
    issuerCity: 'Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Beispielbank',
    iban: 'DE89370400440532013000'
  }, settings.revision);
  const value = draft();
  const draftRevision = await saveInvoice(folder, value, null);
  const originalPdf = Buffer.from('%PDF-original');
  const xml = '<Invoice>frozen facts</Invoice>';
  const issued = await issueInvoice(folder, value.id, draftRevision, async () => ({ pdf: originalPdf, xml }));
  const before = (await fs.readFile(path.join(folder, 'invoices', `${value.id}.json`), 'utf8'));

  await assert.rejects(redesignInvoice(folder, value.id, issued.revision, async () => {
    throw new Error('PDF/A validation failed');
  }), /PDF\/A validation failed/);
  await assert.rejects(redesignInvoice(folder, value.id, issued.revision, async () => ({
    pdf: Buffer.from('%PDF-changed-facts'),
    xml: '<Invoice>changed facts</Invoice>'
  })), /fachlichen Rechnungs-XML-Daten nicht ändern/);

  assert.equal(await fs.readFile(path.join(folder, 'invoices', `${value.id}.json`), 'utf8'), before);
  assert.deepEqual(await readInvoicePdf(folder, value.id), originalPdf);
  assert.deepEqual(await fs.readdir(path.join(folder, 'invoices', 'pdf')), [`${value.id}.pdf`]);
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

test('renders reordered custom invoice fields, generated blocks and shared CSS safely', () => {
  const value = draft({
    recipient: {
      name: '<script>bad()</script>',
      company: 'Verein & Team',
      street: 'Straße 1',
      postalCode: '12345',
      city: 'Musterstadt'
    }
  });
  const fields = [
    'invoice_number', 'issuer_name', 'issuer_address', 'issuer_identifier',
    'recipient_name', 'recipient_company', 'recipient_address', 'invoice_date',
    'service_details', 'due_date', 'items', 'total', 'bank_name', 'iban', 'bic', 'girocode'
  ];
  const template = `<main><h1>{{invoice_number}}</h1>${fields.reverse().map(field => `<section>{{${field}}}</section>`).join('')}</main>`;
  const html = invoiceHtml(value, {
    issuerName: 'Club <Admin>',
    issuerAddress: 'Vereinsweg 2\n12345 Musterstadt',
    issuerIdentifier: 'VR 1234',
    bankName: 'Bank & Co',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX'
  }, {
    template,
    number: 'RE-2026-0001',
    qrDataUrl: 'data:image/png;base64,ZmFrZQ==',
    sharedCss: '.custom-invoice { color: red }'
  });

  assert.ok(html.indexOf('DE89370400440532013000') < html.indexOf('<table'));
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /Club &lt;Admin&gt;/);
  assert.match(html, /Verein &amp; Team/);
  assert.match(html, /<table>[\s\S]*Erste Leistung[\s\S]*<\/table>/);
  assert.match(html, /<img src="data:image\/png;base64,ZmFrZQ==" alt="GiroCode/);
  assert.match(html, /\.custom-invoice \{ color: red \}/);
  assert.doesNotMatch(html, /<script>/);
});

test('rejects invalid invoice templates again when producing document HTML', () => {
  for (const template of [
    '<main>{{invoice_number}} {{unknown}}</main>',
    '<main>{{invoice_number}}</main>',
    '<main>{{invoice_number}}<script>run()</script></main>'
  ]) {
    assert.throws(() => invoiceHtml(draft(), {}, { template }), /Rechnungsvorlage|Platzhalter|Element|Skript/i);
  }
});
