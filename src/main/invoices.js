const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./storage');
const { escapeHtml } = require('./protocol');
const { isDate, formatDate } = require('../shared/dates');
const { parseQuantity, calculateInvoiceTotal, formatCents } = require('../shared/invoice-amounts');
const { buildEpcPayload, normalizeIban } = require('./invoice-epc');
const { validateInvoiceTemplate, renderInvoiceTemplate } = require('./invoice-template');
const lockfile = require('proper-lockfile');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issueQueues = new Map();

function revision(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validateAddress(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return false;
  return ['name', 'company', 'street', 'postalCode', 'city'].every(field => typeof address[field] === 'string') &&
    (address.countryCode === undefined || (typeof address.countryCode === 'string' && /^[A-Z]{2}$/.test(address.countryCode)));
}

function validateInvoiceDraft(invoice) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice) ||
      typeof invoice.id !== 'string' || !ID.test(invoice.id) ||
      typeof invoice.invoiceDate !== 'string' ||
      typeof invoice.serviceDate !== 'string' ||
      typeof invoice.servicePeriodStart !== 'string' ||
      typeof invoice.servicePeriodEnd !== 'string' ||
      typeof invoice.dueDate !== 'string' ||
      !validateAddress(invoice.recipient) || !Array.isArray(invoice.items) ||
      !invoice.items.length) {
    throw new Error('Ungültige Rechnungsdaten.');
  }
  if (!invoice.invoiceDate) throw new Error('Geben Sie ein Rechnungsdatum an.');
  if (!invoice.dueDate) throw new Error('Geben Sie ein Fälligkeitsdatum an.');
  if (!invoice.recipient.name.trim()) throw new Error('Geben Sie einen Empfängername an.');
  if (!invoice.recipient.street.trim() || !invoice.recipient.postalCode.trim() ||
      !invoice.recipient.city.trim()) throw new Error('Vervollständigen Sie die Empfängeranschrift.');
  if (!invoice.serviceDate && (!invoice.servicePeriodStart || !invoice.servicePeriodEnd)) {
    throw new Error('Geben Sie ein Leistungsdatum oder einen vollständigen Leistungszeitraum an.');
  }
  if (invoice.servicePeriodStart && !invoice.servicePeriodEnd) {
    throw new Error('Geben Sie ein vollständiges Leistungsende an.');
  }
  if (invoice.servicePeriodEnd && !invoice.servicePeriodStart) {
    throw new Error('Geben Sie einen vollständigen Leistungsbeginn an.');
  }
  if (invoice.invoiceDate && !isDate(invoice.invoiceDate)) throw new Error('Ungültiges Rechnungsdatum.');
  if (invoice.serviceDate && !isDate(invoice.serviceDate)) throw new Error('Ungültiges Leistungsdatum.');
  if (invoice.servicePeriodStart && !isDate(invoice.servicePeriodStart)) throw new Error('Ungültiges Leistungsbeginn-Datum.');
  if (invoice.servicePeriodEnd && !isDate(invoice.servicePeriodEnd)) throw new Error('Ungültiges Leistungsende-Datum.');
  if (invoice.dueDate && !isDate(invoice.dueDate)) throw new Error('Ungültiges Fälligkeitsdatum.');
  for (const item of invoice.items) {
    if (!item || typeof item.description !== 'string' || !item.description.trim() ||
        typeof item.unit !== 'string' || !item.unit.trim()) {
      throw new Error('Ungültige Rechnungsposition.');
    }
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new Error('Der Einzelpreis muss ein nicht negativer Eurobetrag mit höchstens zwei Nachkommastellen sein.');
    }
    parseQuantity(item.quantity);
  }
  const total = calculateInvoiceTotal(invoice.items);
  if (total.cents <= 0) throw new Error('Die Rechnung muss eine positive Gesamtsumme haben.');
  return total;
}

function invoicePath(folder, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Ungültige Rechnungs-ID.');
  return path.join(folder, 'invoices', `${id}.json`);
}

async function acquireInvoiceLock(folder, id) {
  try {
    return await lockfile.lock(invoicePath(folder, id), { realpath: false, retries: 0 });
  } catch (error) {
    if (error.code === 'ELOCKED') throw new Error('Diese Rechnung wird gerade in einem anderen ClubManager bearbeitet.');
    throw error;
  }
}

function invoicePdfPath(folder, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Ungültige Rechnungs-ID.');
  return path.join(folder, 'invoices', 'pdf', `${id}.pdf`);
}

function invoicePdfRevisionPath(folder, id, revisionId) {
  if (revisionId === 'initial') return invoicePdfPath(folder, id);
  if (typeof id !== 'string' || !ID.test(id) || typeof revisionId !== 'string' || !ID.test(revisionId)) {
    throw new Error('Ungültige PDF-Revision.');
  }
  return path.join(folder, 'invoices', 'pdf', `${id}-${revisionId}.pdf`);
}

function invoiceNumberPath(folder, number) {
  if (!/^[A-Z0-9]+-\d{4}-\d+$/.test(number)) throw new Error('Ungültige Rechnungsnummer.');
  return path.join(folder, 'invoices', 'numbers', `${number}.json`);
}

async function readInvoiceRecord(folder, id) {
  const file = invoicePath(folder, id);
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let record;
  try {
    record = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${path.basename(file)} konnte nicht gelesen werden: ungültiges JSON.`);
  }
  if (!record || record.version !== 1 || record.invoice?.id !== id) {
    throw new Error(`${path.basename(file)} konnte nicht gelesen werden: ungültiger Rechnungsdatensatz.`);
  }
  validateInvoiceDraft(record.invoice);
  if (record.issued !== undefined && (!record.issued || typeof record.issued.number !== 'string' ||
      typeof record.issued.pdfRevision !== 'string' || !record.issued.snapshot)) {
    throw new Error(`${path.basename(file)} konnte nicht gelesen werden: ungültige Ausstellungsdaten.`);
  }
  if (record.issued && record.issued.pdfRevisions === undefined) {
    record.issued.pdfRevisions = [{
      id: 'initial',
      pdfRevision: record.issued.pdfRevision,
      createdAt: record.issued.issuedAt
    }];
  }
  if (record.issued?.pdfRevisions !== undefined) {
    const revisions = record.issued.pdfRevisions;
    if (!Array.isArray(revisions) || revisions.length === 0 ||
        revisions.some(item => !item || typeof item.id !== 'string' ||
          (item.id !== 'initial' && !ID.test(item.id)) ||
          typeof item.pdfRevision !== 'string' || !/^[0-9a-f]{64}$/.test(item.pdfRevision) ||
          typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) ||
        new Set(revisions.map(item => item.id)).size !== revisions.length ||
        revisions.at(-1).pdfRevision !== record.issued.pdfRevision) {
      throw new Error(`${path.basename(file)} konnte nicht gelesen werden: ungültige PDF-Revisionen.`);
    }
  }
  return { record, content };
}

async function listInvoices(folder) {
  let entries;
  try {
    entries = await fs.readdir(path.join(folder, 'invoices'), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json') && item.name !== 'settings.json')) {
    const id = entry.name.slice(0, -5);
    const stored = await readInvoiceRecord(folder, id);
    if (!stored) throw new Error(`${entry.name} konnte nicht gelesen werden: Rechnungsdatensatz fehlt.`);
    records.push({
      invoice: stored.record.invoice,
      revision: revision(stored.content),
      ...(stored.record.issued ? { issued: stored.record.issued } : {})
    });
  }
  return records.sort((a, b) => b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) ||
    a.invoice.id.localeCompare(b.invoice.id));
}

async function saveInvoice(folder, invoice, expectedRevision) {
  validateInvoiceDraft(invoice);
  const file = invoicePath(folder, invoice.id);
  const release = await acquireInvoiceLock(folder, invoice.id);
  try {
    let existing;
    let existingRecord;
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing !== undefined) {
      try {
        existingRecord = JSON.parse(existing);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error(`${path.basename(file)} konnte nicht gelesen werden: ungültiges JSON.`);
      }
    }
    if (existingRecord?.issued) throw new Error('Eine ausgestellte Rechnung kann nicht mehr geändert werden.');
    if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
      throw new Error('Die Rechnung wurde auf dem Datenträger geändert. Laden Sie sie vor dem Speichern neu.');
    }
    const content = JSON.stringify({ version: 1, invoice }, null, 2) + '\n';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, content);
    return revision(content);
  } finally {
    await release();
  }
}

function settingsPath(folder) {
  return path.join(folder, 'invoices', 'settings.json');
}

function validateInvoiceSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      typeof settings.issuerName !== 'string' ||
      typeof settings.bankName !== 'string' ||
      typeof settings.iban !== 'string' ||
      typeof settings.bic !== 'string' ||
      !Number.isSafeInteger(settings.paymentDays) || settings.paymentDays < 0) {
    throw new Error('Die Rechnungseinstellungen sind ungültig.');
  }
  const fields = ['issuerStreet', 'issuerPostalCode', 'issuerCity'].map(field => settings[field]);
  const legacyAddress = typeof settings.issuerAddress === 'string' ? settings.issuerAddress : '';
  let [issuerStreet, issuerPostalCode, issuerCity] = fields;
  if (fields.every(value => value === undefined || value === '') && legacyAddress.trim()) {
    const lines = legacyAddress.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const postalLine = /^(\d{4,10})\s+(.+)$/.exec(lines.at(-1) || '');
    issuerStreet = postalLine ? lines.slice(0, -1).join('\n') : '';
    issuerPostalCode = postalLine?.[1] || '';
    issuerCity = postalLine?.[2] || '';
  }
  for (const value of [issuerStreet, issuerPostalCode, issuerCity]) {
    if (value !== undefined && typeof value !== 'string') throw new Error('Die Anschrift des Ausstellers ist ungültig.');
  }
  issuerStreet ??= '';
  issuerPostalCode ??= '';
  issuerCity ??= '';
  const issuerCountryCode = settings.issuerCountryCode === undefined ? 'DE' : settings.issuerCountryCode;
  if (typeof issuerCountryCode !== 'string' || !/^[A-Z]{2}$/.test(issuerCountryCode)) {
    throw new Error('Der Ländercode des Ausstellers muss aus zwei Großbuchstaben bestehen.');
  }
  const issuerIdentifier = settings.issuerIdentifier === undefined ? '' : settings.issuerIdentifier;
  const issuerIdentifierType = settings.issuerIdentifierType === undefined ? 'registration' : settings.issuerIdentifierType;
  if (typeof issuerIdentifier !== 'string' || !['registration', 'vat'].includes(issuerIdentifierType)) {
    throw new Error('Die Ausstellerkennung ist ungültig.');
  }
  const invoicePrefix = settings.invoicePrefix === undefined ? 'RE' : settings.invoicePrefix;
  const invoiceStartNumber = settings.invoiceStartNumber === undefined ? 1 : settings.invoiceStartNumber;
  if (typeof invoicePrefix !== 'string' || !/^[A-Z0-9]{1,10}$/.test(invoicePrefix)) {
    throw new Error('Das Rechnungsnummern-Präfix muss aus 1 bis 10 Buchstaben oder Ziffern bestehen.');
  }
  if (!Number.isSafeInteger(invoiceStartNumber) || invoiceStartNumber < 1) {
    throw new Error('Der Rechnungsnummern-Startwert muss eine positive ganze Zahl sein.');
  }
  return {
    issuerName: settings.issuerName,
    issuerAddress: [issuerStreet, `${issuerPostalCode} ${issuerCity}`.trim()].filter(Boolean).join('\n') || legacyAddress,
    issuerStreet,
    issuerPostalCode,
    issuerCity,
    issuerCountryCode,
    issuerIdentifier,
    issuerIdentifierType,
    bankName: settings.bankName,
    iban: settings.iban,
    bic: settings.bic,
    paymentDays: settings.paymentDays,
    invoicePrefix,
    invoiceStartNumber
  };
}

async function loadInvoiceSettings(folder) {
  const file = settingsPath(folder);
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        settings: {
          issuerName: '', issuerAddress: '', bankName: '', iban: '', bic: '', paymentDays: 14,
          invoicePrefix: 'RE', invoiceStartNumber: 1, issuerStreet: '', issuerPostalCode: '',
          issuerCity: '', issuerCountryCode: 'DE', issuerIdentifier: '', issuerIdentifierType: 'registration'
        },
        revision: null
      };
    }
    throw error;
  }
  let record;
  try {
    record = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Die Rechnungseinstellungen enthalten ungültiges JSON.');
  }
  if (!record || record.version !== 1) throw new Error('Die Rechnungseinstellungen sind ungültig.');
  return { settings: validateInvoiceSettings(record.settings), revision: revision(content) };
}

async function saveInvoiceSettings(folder, settings, expectedRevision) {
  const value = validateInvoiceSettings(settings);
  const file = settingsPath(folder);
  let existing;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
    throw new Error('Die Rechnungseinstellungen wurden auf dem Datenträger geändert. Laden Sie sie neu.');
  }
  const content = JSON.stringify({ version: 1, settings: value }, null, 2) + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, content);
  return { settings: value, revision: revision(content) };
}

function validateIssuance(invoice, settings) {
  const total = validateInvoiceDraft(invoice);
  if (invoice.serviceDate && (invoice.servicePeriodStart || invoice.servicePeriodEnd)) {
    throw new Error('Geben Sie entweder ein Leistungsdatum oder einen Leistungszeitraum an, nicht beides.');
  }
  const normalized = validateInvoiceSettings(settings);
  if (!normalized.issuerName.trim()) throw new Error('Geben Sie einen Ausstellernamen an.');
  if (!normalized.issuerIdentifier.trim()) {
    throw new Error('Geben Sie eine Vereins-/Handelsregisterkennung oder Umsatzsteuer-ID des Ausstellers an.');
  }
  if (normalized.issuerIdentifierType === 'vat' &&
      !/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(normalized.issuerIdentifier.trim().toUpperCase())) {
    throw new Error('Die Umsatzsteuer-ID des Ausstellers ist ungültig.');
  }
  if (!normalized.issuerStreet.trim() || !normalized.issuerPostalCode.trim() || !normalized.issuerCity.trim()) {
    throw new Error('Vervollständigen Sie die Ausstelleranschrift mit Straße, Postleitzahl und Ort.');
  }
  if (!normalized.bankName.trim()) throw new Error('Geben Sie einen Banknamen an.');
  const iban = normalizeIban(normalized.iban);
  const bic = normalized.bic.trim().toUpperCase();
  const frozenInvoice = JSON.parse(JSON.stringify(invoice));
  frozenInvoice.recipient.countryCode ||= 'DE';
  return {
    number: null,
    invoice: frozenInvoice,
    issuer: {
      name: normalized.issuerName.trim(),
      identifier: normalized.issuerIdentifier.trim(),
      identifierType: normalized.issuerIdentifierType,
      address: {
        street: normalized.issuerStreet.trim(),
        postalCode: normalized.issuerPostalCode.trim(),
        city: normalized.issuerCity.trim(),
        countryCode: normalized.issuerCountryCode
      },
      bankName: normalized.bankName.trim(),
      iban,
      bic
    },
    totalCents: total.cents
  };
}

function queueInvoiceIssue(folder, operation) {
  const previous = issueQueues.get(folder) || Promise.resolve();
  const result = previous.then(operation);
  const queued = result.catch(() => {});
  issueQueues.set(folder, queued);
  return result.finally(() => {
    if (issueQueues.get(folder) === queued) issueQueues.delete(folder);
  });
}

function formatInvoiceNumber(prefix, year, sequence) {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

async function reserveInvoiceNumber(folder, invoice, settings) {
  const used = new Set((await listInvoices(folder)).map(item => item.issued?.number).filter(Boolean));
  const year = invoice.invoiceDate.slice(0, 4);
  for (let sequence = settings.invoiceStartNumber; Number.isSafeInteger(sequence); sequence++) {
    const number = formatInvoiceNumber(settings.invoicePrefix, year, sequence);
    if (used.has(number)) continue;
    const file = invoiceNumberPath(folder, number);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ number }), { flag: 'wx' });
      return { number, file };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Es konnte keine freie Rechnungsnummer vergeben werden.');
}

async function issueInvoice(folder, id, expectedRevision, generateArtifact) {
  if (typeof generateArtifact !== 'function') throw new Error('Der PDF-Erzeuger ist ungültig.');
  return queueInvoiceIssue(folder, async () => {
    const release = await acquireInvoiceLock(folder, id);
    try {
      const stored = await readInvoiceRecord(folder, id);
      if (!stored) throw new Error('Der Rechnungsentwurf wurde nicht gefunden.');
      if (stored.record.issued) throw new Error('Die Rechnung wurde bereits ausgestellt.');
      if (revision(stored.content) !== expectedRevision) {
        throw new Error('Der Rechnungsentwurf wurde geändert. Laden Sie ihn vor der Ausstellung neu.');
      }
      const { settings } = await loadInvoiceSettings(folder);
      const snapshot = validateIssuance(stored.record.invoice, settings);
      const { number, file: numberFile } = await reserveInvoiceNumber(folder, stored.record.invoice, settings);
      snapshot.number = number;
      let committed = false;
      const pdfFile = invoicePdfPath(folder, id);
      try {
        buildEpcPayload(snapshot);
        const artifact = await generateArtifact(snapshot);
        if (!artifact || !(Buffer.isBuffer(artifact.pdf) || artifact.pdf instanceof Uint8Array) ||
            typeof artifact.xml !== 'string' || !artifact.xml.trim()) {
          throw new Error('Die ZUGFeRD-Rechnung konnte nicht vollständig erstellt werden.');
        }
        const current = await readInvoiceRecord(folder, id);
        if (!current || current.record.issued || revision(current.content) !== expectedRevision) {
          throw new Error('Der Rechnungsentwurf wurde während der Ausstellung geändert.');
        }
        const pdf = Buffer.from(artifact.pdf);
        const pdfRevision = revision(pdf);
        await fs.mkdir(path.dirname(pdfFile), { recursive: true });
        await atomicWrite(pdfFile, pdf);
        const issuedAt = new Date().toISOString();
        const issued = {
          number,
          issuedAt,
          snapshot,
          xmlRevision: revision(artifact.xml),
          pdfRevision,
          pdfRevisions: [{ id: 'initial', pdfRevision, createdAt: issuedAt }]
        };
        const content = JSON.stringify({ version: 1, invoice: current.record.invoice, issued }, null, 2) + '\n';
        await atomicWrite(invoicePath(folder, id), content);
        committed = true;
        return { invoice: current.record.invoice, issued, revision: revision(content) };
      } finally {
        if (!committed) {
          await fs.rm(pdfFile, { force: true });
          await fs.rm(numberFile, { force: true });
        }
      }
    } finally {
      await release();
    }
  });
}

async function redesignInvoice(folder, id, expectedRevision, generateArtifact) {
  if (typeof generateArtifact !== 'function') throw new Error('Der PDF-Erzeuger ist ungültig.');
  return queueInvoiceIssue(folder, async () => {
    const release = await acquireInvoiceLock(folder, id);
    try {
      const stored = await readInvoiceRecord(folder, id);
      if (!stored?.record.issued) throw new Error('Die Rechnung wurde noch nicht ausgestellt.');
      if (revision(stored.content) !== expectedRevision) {
        throw new Error('Die ausgestellte Rechnung wurde geändert. Laden Sie sie vor der Neugestaltung neu.');
      }
      const snapshot = JSON.parse(JSON.stringify(stored.record.issued.snapshot));
      const artifact = await generateArtifact(snapshot);
      if (!artifact || !(Buffer.isBuffer(artifact.pdf) || artifact.pdf instanceof Uint8Array) ||
          typeof artifact.xml !== 'string' || !artifact.xml.trim()) {
        throw new Error('Die ZUGFeRD-Rechnung konnte nicht vollständig erstellt werden.');
      }
      if (revision(artifact.xml) !== stored.record.issued.xmlRevision) {
        throw new Error('Die Neugestaltung darf die fachlichen Rechnungs-XML-Daten nicht ändern.');
      }
      const current = await readInvoiceRecord(folder, id);
      if (!current?.record.issued || revision(current.content) !== expectedRevision) {
        throw new Error('Die ausgestellte Rechnung wurde während der Neugestaltung geändert.');
      }

      const pdf = Buffer.from(artifact.pdf);
      const pdfRevision = revision(pdf);
      const revisionId = crypto.randomUUID();
      const pdfFile = invoicePdfRevisionPath(folder, id, revisionId);
      await fs.mkdir(path.dirname(pdfFile), { recursive: true });
      await atomicWrite(pdfFile, pdf);
      let committed = false;
      try {
        const latest = await readInvoiceRecord(folder, id);
        if (!latest?.record.issued || revision(latest.content) !== expectedRevision) {
          throw new Error('Die ausgestellte Rechnung wurde während der Neugestaltung geändert.');
        }
        const createdAt = new Date().toISOString();
        const issued = {
          ...latest.record.issued,
          pdfRevision,
          pdfRevisions: [
            ...latest.record.issued.pdfRevisions,
            { id: revisionId, pdfRevision, createdAt }
          ]
        };
        const content = JSON.stringify({
          version: 1,
          invoice: latest.record.invoice,
          issued
        }, null, 2) + '\n';
        await atomicWrite(invoicePath(folder, id), content);
        committed = true;
        return { invoice: latest.record.invoice, issued, revision: revision(content) };
      } finally {
        if (!committed) await fs.rm(pdfFile, { force: true });
      }
    } finally {
      await release();
    }
  });
}

async function readInvoicePdf(folder, id, revisionId) {
  const stored = await readInvoiceRecord(folder, id);
  if (!stored?.record.issued) throw new Error('Für diesen Rechnungsentwurf gibt es noch kein ausgestelltes PDF.');
  const revisions = stored.record.issued.pdfRevisions;
  const selected = revisionId === undefined
    ? revisions.at(-1)
    : revisions.find(item => item.id === revisionId);
  if (!selected) throw new Error('Die ausgewählte PDF-Revision wurde nicht gefunden.');
  let pdf;
  try {
    pdf = await fs.readFile(invoicePdfRevisionPath(folder, id, selected.id));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Das gespeicherte Rechnungs-PDF fehlt.');
    throw error;
  }
  if (revision(pdf) !== selected.pdfRevision) {
    throw new Error('Das gespeicherte Rechnungs-PDF wurde verändert.');
  }
  return pdf;
}

function countryName(code) {
  if (!code) return '';
  return new Intl.DisplayNames(['de'], { type: 'region' }).of(code) || code;
}

function invoiceHtml(invoice, settings, options = {}) {
  const recipientCountry = countryName(invoice.recipient.countryCode || 'DE');
  const issuer = settings.issuer || settings;
  const recipient = [
    invoice.recipient.company,
    invoice.recipient.name,
    invoice.recipient.street,
    [invoice.recipient.postalCode, invoice.recipient.city].filter(Boolean).join(' '),
    recipientCountry
  ].filter(line => line.trim()).map(escapeHtml).join('<br>');
  const issuerAddressText = issuer.address
    ? [
      issuer.address.street,
      `${issuer.address.postalCode} ${issuer.address.city}`.trim(),
      countryName(issuer.address.countryCode)
    ].filter(Boolean).join('\n')
    : settings.issuerAddress || '';
  const issuerAddress = issuer.address
    ? [
      issuer.address.street,
      `${issuer.address.postalCode} ${issuer.address.city}`.trim(),
      countryName(issuer.address.countryCode)
    ].filter(Boolean).map(escapeHtml).join('<br>')
    : escapeHtml(settings.issuerAddress || '').replace(/\r?\n/g, '<br>');
  const total = calculateInvoiceTotal(invoice.items);
  const items = invoice.items.map((item, index) => {
    const cents = total.itemsCents[index];
    return `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unit)}</td><td>${escapeHtml(formatCents(item.unitPriceCents))}</td><td>${escapeHtml(formatCents(cents))}</td></tr>`;
  }).join('');
  const due = invoice.dueDate ? `Fälligkeitsdatum: ${escapeHtml(formatDate(invoice.dueDate))}` : '';
  const service = invoice.servicePeriodStart || invoice.servicePeriodEnd
    ? `Leistungszeitraum: ${escapeHtml([invoice.servicePeriodStart, invoice.servicePeriodEnd].filter(Boolean).map(formatDate).join(' – '))}`
    : `Leistungsdatum: ${escapeHtml(formatDate(invoice.serviceDate))}`;
  const qr = options.qrDataUrl
    ? `<section class="payment-code"><div><h2>Per GiroCode bezahlen</h2><p>Scannen Sie den Code mit Ihrer Banking-App.</p></div><img src="${escapeHtml(options.qrDataUrl)}" alt="GiroCode für Rechnung ${escapeHtml(options.number)}"></section>`
    : '';
  const body = options.template
    ? renderInvoiceTemplate(options.template, {
      invoice_number: options.number || '',
      issuer_name: issuer.name || settings.issuerName || '',
      issuer_address: issuerAddressText,
      issuer_identifier: issuer.identifier || settings.issuerIdentifier || '',
      recipient_name: invoice.recipient.name,
      recipient_company: invoice.recipient.company,
      recipient_address: [
        invoice.recipient.street,
        [invoice.recipient.postalCode, invoice.recipient.city].filter(Boolean).join(' '),
        recipientCountry
      ].filter(Boolean).join('\n'),
      invoice_date: formatDate(invoice.invoiceDate),
      service_details: invoice.servicePeriodStart || invoice.servicePeriodEnd
        ? `Leistungszeitraum: ${[invoice.servicePeriodStart, invoice.servicePeriodEnd].filter(Boolean).map(formatDate).join(' – ')}`
        : `Leistungsdatum: ${formatDate(invoice.serviceDate)}`,
      due_date: formatDate(invoice.dueDate),
      items: `<table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Summe</th></tr></thead><tbody>${items}</tbody></table>`,
      total: formatCents(total.cents),
      bank_name: issuer.bankName || settings.bankName || '',
      iban: issuer.iban || settings.iban || '',
      bic: issuer.bic || settings.bic || '',
      girocode: qr
    })
    : `<main>
      <h1>Rechnung</h1><p><strong>${escapeHtml(issuer.name || settings.issuerName || '')}</strong></p><p>${issuerAddress}</p>
      ${issuer.identifier ? `<p>Ausstellerkennung: ${escapeHtml(issuer.identifier)}</p>` : ''}
      ${options.number ? `<p><strong>Rechnungsnummer: ${escapeHtml(options.number)}</strong></p>` : ''}
      <div class="invoice-meta"><div>${recipient}</div><div>
        <p>Rechnungsdatum: ${escapeHtml(formatDate(invoice.invoiceDate))}</p><p>${service}</p><p>${due}</p>
      </div></div>
      <table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Summe</th></tr></thead><tbody>${items}</tbody></table>
      <p class="total"><strong>Gesamtsumme: ${escapeHtml(formatCents(total.cents))}</strong></p>
      <p>${escapeHtml(issuer.bankName || settings.bankName || '')}<br>IBAN: ${escapeHtml(issuer.iban || settings.iban || '')}<br>BIC: ${escapeHtml(issuer.bic || settings.bic || '')}</p>
      ${qr}
    </main>`;
  const sharedCss = String(options.sharedCss || '').replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><style>
    @page { size: A4; margin: 20mm }
    body { color: #24292f; font: 10pt/1.45 sans-serif; margin: 0 }
    h1 { font-size: 24pt; margin: 0 0 4mm }
    h2 { font-size: 12pt; margin: 7mm 0 2mm }
    .invoice-meta { display: flex; justify-content: space-between; gap: 12mm; margin-bottom: 12mm }
    .invoice-meta p { margin: 0 }
    table { border-collapse: collapse; width: 100%; margin-top: 8mm }
    th, td { border-bottom: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top }
    th:last-child, td:last-child, th:nth-last-child(2), td:nth-last-child(2) { text-align: right }
    .total { text-align: right; font-size: 13pt; margin-top: 5mm }
    .payment-code { display: flex; align-items: center; justify-content: space-between; gap: 8mm; margin-top: 10mm; border-top: 1px solid #ccc; padding-top: 5mm; break-inside: avoid }
    .payment-code h2 { margin: 0 0 2mm }
    .payment-code img { width: 40mm; height: 40mm; image-rendering: pixelated }
    .invoice-address { white-space: pre-line }
    .total { text-align: right }
  </style><style>${sharedCss}</style></head><body>${body}</body></html>`;
}

module.exports = {
  calculateInvoiceTotal,
  validateInvoiceDraft,
  invoicePath,
  listInvoices,
  saveInvoice,
  validateInvoiceSettings,
  loadInvoiceSettings,
  saveInvoiceSettings,
  issueInvoice,
  redesignInvoice,
  readInvoicePdf,
  invoiceHtml,
  validateInvoiceTemplate,
  formatCents
};
