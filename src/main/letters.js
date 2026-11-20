const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./storage');
const { escapeHtml, markdown, renderTemplate } = require('./protocol');
const { isDate, formatDate } = require('../shared/dates');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholders = { title: '', date: '', address: '', content: '', signatures: '' };
const customPlaceholderKey = /^[a-z][a-z0-9_]*$/;
const reservedPlaceholderKeys = new Set(Object.keys(placeholders));
const addressFields = ['name', 'company', 'street', 'postalCode', 'city'];

function validateLetterPlaceholders(value) {
  if (!Array.isArray(value)) throw new Error('Die benutzerdefinierten Briefplatzhalter sind ungültig.');
  const keys = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).length !== 2 || !Object.hasOwn(item, 'key') || !Object.hasOwn(item, 'value') ||
        typeof item.key !== 'string' || !customPlaceholderKey.test(item.key) ||
        reservedPlaceholderKeys.has(item.key) || keys.has(item.key) ||
        typeof item.value !== 'string' || /[\r\n]/.test(item.value)) {
      throw new Error('Ein benutzerdefinierter Briefplatzhalter ist ungültig. Verwenden Sie eindeutige Schlüssel in Kleinbuchstaben und einzeilige Textwerte.');
    }
    keys.add(item.key);
    return { key: item.key, value: item.value };
  });
}

function letterPlaceholdersPath(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    throw new Error('Der Datenordner für Briefplatzhalter ist ungültig.');
  }
  return path.join(folder, 'customizations', 'letter-placeholders.json');
}

async function loadLetterPlaceholders(folder) {
  const file = letterPlaceholdersPath(folder);
  let content;
  try { content = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { placeholders: [], revision: null };
    throw error;
  }
  let record;
  try { record = JSON.parse(content); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Die benutzerdefinierten Briefplatzhalter enthalten ungültiges JSON.');
  }
  if (!record || record.version !== 1 || !Array.isArray(record.placeholders)) {
    throw new Error('Die benutzerdefinierten Briefplatzhalter sind ungültig.');
  }
  return { placeholders: validateLetterPlaceholders(record.placeholders), revision: revision(content) };
}

async function saveLetterPlaceholders(folder, value, expectedRevision) {
  const customPlaceholders = validateLetterPlaceholders(value);
  if (expectedRevision !== null && typeof expectedRevision !== 'string') {
    throw new Error('Die Revision der benutzerdefinierten Briefplatzhalter ist ungültig.');
  }
  const file = letterPlaceholdersPath(folder);
  let existing;
  try { existing = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
    throw new Error('Die benutzerdefinierten Briefplatzhalter wurden auf dem Datenträger geändert. Laden Sie die Einstellungen neu.');
  }
  const content = JSON.stringify({ version: 1, placeholders: customPlaceholders }, null, 2) + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, content, async () => {
    let current;
    try { current = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((current === undefined ? null : revision(current)) !== expectedRevision) {
      throw new Error('Die benutzerdefinierten Briefplatzhalter wurden auf dem Datenträger geändert. Laden Sie die Einstellungen neu.');
    }
  });
  return { placeholders: customPlaceholders, revision: revision(content) };
}

function validateLetter(letter) {
  const validAddress = letter && (typeof letter.address === 'string' ||
    (letter.address && typeof letter.address === 'object' && !Array.isArray(letter.address) &&
      addressFields.every(field => typeof letter.address[field] === 'string')));
  if (!letter || typeof letter.id !== 'string' || !ID.test(letter.id) || typeof letter.title !== 'string' ||
      typeof letter.date !== 'string' || (letter.date !== '' && !isDate(letter.date)) ||
      typeof letter.content !== 'string' || typeof letter.includeAddress !== 'boolean' ||
      !validAddress || !Array.isArray(letter.signatures) ||
      letter.signatures.some(id => typeof id !== 'string' || !ID.test(id)) ||
      new Set(letter.signatures).size !== letter.signatures.length) {
    throw new Error('Ungültige Briefdaten.');
  }
}

function normalizeLetter(letter) {
  if (typeof letter.address !== 'string') return letter;
  return { ...letter, address: { name: letter.address, company: '', street: '', postalCode: '', city: '' } };
}

function letterPath(folder, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Ungültige Brief-ID.');
  return path.join(folder, 'letters', `${id}.json`);
}

function pdfPath(folder, id) {
  letterPath(folder, id);
  return path.join(folder, 'letters', 'pdf', `${id}.pdf`);
}

async function hasPdf(folder, id) {
  try {
    const info = await fs.lstat(pdfPath(folder, id));
    if (!info.isFile()) throw new Error('Das Brief-PDF ist keine reguläre Datei.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readPdf(folder, id) {
  if (!await hasPdf(folder, id)) throw new Error('Das Brief-PDF wurde nicht gefunden. Exportieren Sie es erneut.');
  return fs.readFile(pdfPath(folder, id));
}

function revision(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function listLetters(folder) {
  const entries = (await fs.readdir(path.join(folder, 'letters'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'));
  const records = [];
  for (let index = 0; index < entries.length; index += 8) {
    records.push(...await Promise.all(entries.slice(index, index + 8).map(async entry => {
      const id = entry.name.slice(0, -5);
      const content = await fs.readFile(letterPath(folder, id), 'utf8');
      let record;
      try { record = JSON.parse(content); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error(`${entry.name} konnte nicht gelesen werden: ungültiges JSON.`);
      }
      if (!record || record.version !== 1 || record.letter?.id !== id) {
        throw new Error(`${entry.name} konnte nicht gelesen werden: ungültiger Briefdatensatz.`);
      }
      validateLetter(record.letter);
      return { letter: normalizeLetter(record.letter), revision: revision(content) };
    })));
  }
  return records.sort((a, b) => b.letter.date.localeCompare(a.letter.date) || a.letter.title.localeCompare(b.letter.title, 'de'));
}

async function saveLetter(folder, letter, expectedRevision) {
  validateLetter(letter);
  const file = letterPath(folder, letter.id);
  let existing;
  try { existing = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
    throw new Error('Der Brief wurde auf dem Datenträger geändert. Laden Sie ihn vor dem Speichern neu.');
  }
  const content = JSON.stringify({ version: 1, letter }, null, 2) + '\n';
  await atomicWrite(file, content);
  return revision(content);
}

function validateLetterTemplate(template, customPlaceholders = []) {
  const values = Object.fromEntries(validateLetterPlaceholders(customPlaceholders).map(({ key }) => [key, '']));
  renderTemplate(template, { ...placeholders, ...values });
}

function renderLetterContent(content, customValues) {
  const html = markdown(content);
  if (!/\{\{\s*[^{}]+?\s*\}\}/.test(html)) return html;
  return renderTemplate(html, customValues);
}

function letterHtml(letter, css, images, template = null, customPlaceholders = []) {
  const fields = normalizeLetter(letter).address;
  const addressLines = [fields.company, fields.name, fields.street, [fields.postalCode.trim(), fields.city.trim()].filter(Boolean).join(' ')]
    .filter(line => line.trim());
  const address = letter.includeAddress && addressLines.length
    ? `<div class="letter-address">${escapeHtml(addressLines.join('\n')).replace(/\r?\n/g, '<br>')}</div>` : '';
  const signatures = images.length ? `<div class="letter-signatures">${images.map(({ name, data }) =>
    `<figure class="letter-signature"><img src="${escapeHtml(data)}" alt="${escapeHtml(name)}"><figcaption>${escapeHtml(name)}</figcaption></figure>`).join('')}</div>` : '';
  const customValues = Object.fromEntries(validateLetterPlaceholders(customPlaceholders)
    .map(({ key, value }) => [key, escapeHtml(value)]));
  const values = {
    title: escapeHtml(letter.title),
    date: escapeHtml(formatDate(letter.date)),
    address,
    content: renderLetterContent(letter.content, customValues),
    signatures,
    ...customValues
  };
  const body = template === null
    ? `<main class="letter">${address}<p class="letter-date">${values.date}</p><h1>${values.title}</h1><div class="letter-content">${values.content}</div>${signatures}</main>`
    : renderTemplate(template, values);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>@page { size: A4; margin: 20mm; @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 9pt "Source Sans Pro", "Source Sans 3", Arial, sans-serif; } } .letter-signatures { display: flex; flex-wrap: wrap; gap: 12mm; margin-top: 12mm; } .letter-signature { margin: 0; break-inside: avoid; } .letter-signature img { display: block; max-width: 55mm; max-height: 25mm; object-fit: contain; } </style><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${body}</body></html>`;
}

module.exports = {
  validateLetter,
  listLetters,
  saveLetter,
  pdfPath,
  hasPdf,
  readPdf,
  validateLetterPlaceholders,
  loadLetterPlaceholders,
  saveLetterPlaceholders,
  validateLetterTemplate,
  letterHtml
};
