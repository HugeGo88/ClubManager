const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./storage');
const { escapeHtml } = require('./protocol');
const { isDate, formatDate } = require('../shared/dates');
const { parseQuantity, calculateInvoiceTotal, formatCents } = require('../shared/invoice-amounts');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revision(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validateAddress(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return false;
  return ['name', 'company', 'street', 'postalCode', 'city'].every(field => typeof address[field] === 'string');
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
    const content = await fs.readFile(invoicePath(folder, id), 'utf8');
    let record;
    try {
      record = JSON.parse(content);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error(`${entry.name} konnte nicht gelesen werden: ungültiges JSON.`);
    }
    if (!record || record.version !== 1 || record.invoice?.id !== id) {
      throw new Error(`${entry.name} konnte nicht gelesen werden: ungültiger Rechnungsdatensatz.`);
    }
    validateInvoiceDraft(record.invoice);
    records.push({ invoice: record.invoice, revision: revision(content) });
  }
  return records.sort((a, b) => b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) ||
    a.invoice.id.localeCompare(b.invoice.id));
}

async function saveInvoice(folder, invoice, expectedRevision) {
  validateInvoiceDraft(invoice);
  const file = invoicePath(folder, invoice.id);
  let existing;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
    throw new Error('Die Rechnung wurde auf dem Datenträger geändert. Laden Sie sie vor dem Speichern neu.');
  }
  const content = JSON.stringify({ version: 1, invoice }, null, 2) + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, content);
  return revision(content);
}

function settingsPath(folder) {
  return path.join(folder, 'invoices', 'settings.json');
}

function validateInvoiceSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      typeof settings.issuerName !== 'string' ||
      typeof settings.issuerAddress !== 'string' ||
      typeof settings.bankName !== 'string' ||
      typeof settings.iban !== 'string' ||
      typeof settings.bic !== 'string' ||
      !Number.isSafeInteger(settings.paymentDays) || settings.paymentDays < 0) {
    throw new Error('Die Rechnungseinstellungen sind ungültig.');
  }
  return {
    issuerName: settings.issuerName,
    issuerAddress: settings.issuerAddress,
    bankName: settings.bankName,
    iban: settings.iban,
    bic: settings.bic,
    paymentDays: settings.paymentDays
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
          issuerName: '', issuerAddress: '', bankName: '', iban: '', bic: '', paymentDays: 14
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

function invoiceHtml(invoice, settings) {
  const recipient = [
    invoice.recipient.company,
    invoice.recipient.name,
    invoice.recipient.street,
    [invoice.recipient.postalCode, invoice.recipient.city].filter(Boolean).join(' ')
  ].filter(line => line.trim()).map(escapeHtml).join('<br>');
  const issuerAddress = escapeHtml(settings.issuerAddress).replace(/\r?\n/g, '<br>');
  const total = calculateInvoiceTotal(invoice.items);
  const items = invoice.items.map((item, index) => {
    const cents = total.itemsCents[index];
    return `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unit)}</td><td>${escapeHtml(formatCents(item.unitPriceCents))}</td><td>${escapeHtml(formatCents(cents))}</td></tr>`;
  }).join('');
  const due = invoice.dueDate ? `Fälligkeitsdatum: ${escapeHtml(formatDate(invoice.dueDate))}` : '';
  const service = invoice.servicePeriodStart || invoice.servicePeriodEnd
    ? `Leistungszeitraum: ${escapeHtml([invoice.servicePeriodStart, invoice.servicePeriodEnd].filter(Boolean).map(formatDate).join(' – '))}`
    : `Leistungsdatum: ${escapeHtml(formatDate(invoice.serviceDate))}`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>@page { size: A4; margin: 20mm } body { font-family: sans-serif } table { border-collapse: collapse; width: 100% } th, td { border-bottom: 1px solid #ccc; padding: 6px; text-align: left } th:last-child, td:last-child, th:nth-last-child(2), td:nth-last-child(2) { text-align: right }</style></head><body><main>
    <h1>Rechnung</h1><p>${issuerAddress}</p><p><strong>${escapeHtml(settings.issuerName)}</strong></p>
    <div>${recipient}</div><p>Rechnungsdatum: ${escapeHtml(formatDate(invoice.invoiceDate))}</p><p>${service}</p>
    <table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Summe</th></tr></thead><tbody>${items}</tbody></table>
    <p><strong>Gesamtsumme: ${escapeHtml(formatCents(total.cents))}</strong></p><p>${due}</p>
    <p>${escapeHtml(settings.bankName)}<br>IBAN: ${escapeHtml(settings.iban)}<br>BIC: ${escapeHtml(settings.bic)}</p>
  </main></body></html>`;
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
  invoiceHtml,
  formatCents
};
