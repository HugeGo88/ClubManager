const sanitizeHtml = require('sanitize-html');
const { escapeHtml } = require('./protocol');

const PLACEHOLDERS = Object.freeze([
  'invoice_number',
  'issuer_name',
  'issuer_address',
  'issuer_identifier',
  'recipient_name',
  'recipient_company',
  'recipient_address',
  'invoice_date',
  'service_details',
  'due_date',
  'items',
  'total',
  'bank_name',
  'iban',
  'bic',
  'girocode'
]);
const REQUIRED_PLACEHOLDERS = PLACEHOLDERS.filter(name =>
  !['recipient_company', 'bic'].includes(name));
const STRUCTURED_PLACEHOLDERS = new Set(['items', 'girocode']);
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ALLOWED_TAGS = [
  'address', 'article', 'aside', 'b', 'br', 'caption', 'dd', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'li', 'main', 'ol', 'p', 'section', 'small', 'span',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'ul'
];
const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);

function inspectTemplate(template, replace) {
  if (typeof template !== 'string' || !template.trim()) {
    throw new Error('Die HTML-Rechnungsvorlage ist leer.');
  }
  if (/<\s*(?:script|style|template|head|title|noscript|details)\b/i.test(template)) {
    throw new Error('Ausführbare, verdeckte oder einklappbare Bereiche sind in einer Rechnungsvorlage nicht zulässig.');
  }
  if (/<[^>]*\b(?:hidden|style)\s*(?:=|\s|\/?>)|<[^>]*\baria-hidden\s*=\s*(?:"true"|'true'|true)/i.test(template)) {
    throw new Error('Versteckte Bereiche und Inline-Stile sind in einer Rechnungsvorlage nicht zulässig.');
  }
  if (/\son[a-z]+\s*=/i.test(template)) {
    throw new Error('Skriptattribute sind in einer Rechnungsvorlage nicht zulässig.');
  }
  for (const [, tag] of template.matchAll(/<\s*\/?\s*([a-z][a-z0-9:-]*)\b/gi)) {
    if (!ALLOWED_TAG_SET.has(tag.toLowerCase())) {
      throw new Error(`Nicht unterstütztes HTML-Element in der Rechnungsvorlage: ${tag}`);
    }
  }

  const occurrences = [...template.matchAll(PLACEHOLDER_PATTERN)];
  for (const [, name] of occurrences) {
    if (!PLACEHOLDERS.includes(name)) {
      throw new Error(`Unbekannter Platzhalter in der Rechnungsvorlage: ${name}`);
    }
  }
  if (/\{\{|\}\}/.test(template.replace(PLACEHOLDER_PATTERN, ''))) {
    throw new Error('Die Rechnungsvorlage enthält einen ungültigen Platzhalter.');
  }
  if (!occurrences.length) {
    throw new Error('Die Rechnungsvorlage muss die dokumentierten Pflichtplatzhalter enthalten.');
  }

  let inserted = 0;
  const html = sanitizeHtml(template, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ['class', 'id'] },
    disallowedTagsMode: 'discard',
    textFilter(text) {
      return text.replace(PLACEHOLDER_PATTERN, (match, name) => {
        inserted++;
        return replace(name, match);
      });
    }
  });
  if (inserted !== occurrences.length) {
    throw new Error('Platzhalter müssen sichtbar im Text stehen, nicht in Kommentaren oder HTML-Attributen.');
  }
  return html;
}

function validateInvoiceTemplate(template) {
  const inserted = new Set();
  const markers = new Map(PLACEHOLDERS.map((name, index) =>
    [name, `INVOICE_TEMPLATE_FIELD_${index}_`]));
  inspectTemplate(template, name => {
    inserted.add(name);
    return markers.get(name);
  });
  const missing = REQUIRED_PLACEHOLDERS.filter(name => !inserted.has(name));
  if (missing.length) {
    throw new Error(`Die Rechnungsvorlage lässt Pflichtplatzhalter aus: ${missing.map(name => `{{${name}}}`).join(', ')}`);
  }
}

function renderInvoiceTemplate(template, values) {
  validateInvoiceTemplate(template);
  return inspectTemplate(template, name => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Der Rechnungsplatzhalter {{${name}}} hat keinen Ausgabewert.`);
    }
    const value = String(values[name] ?? '');
    return STRUCTURED_PLACEHOLDERS.has(name) ? value : escapeHtml(value);
  });
}

module.exports = { PLACEHOLDERS, REQUIRED_PLACEHOLDERS, validateInvoiceTemplate, renderInvoiceTemplate };
