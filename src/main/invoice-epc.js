const QRCode = require('qrcode');
const { isValidIBAN } = require('ibantools');

function epcText(value, label, maxLength, required = false) {
  if (typeof value !== 'string') throw new Error(`Die EPC-Angabe „${label}“ ist ungültig.`);
  const normalized = value.normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[\u0300-\u036f]/g, '');
  if (required && !normalized.trim()) throw new Error(`Geben Sie ${label} für den GiroCode an.`);
  if (normalized.length > maxLength || /[\r\n]/.test(normalized) ||
      !/^[A-Za-z0-9 /:?().,'+-]*$/.test(normalized)) {
    throw new Error(`Die EPC-Angabe „${label}“ überschreitet das zulässige Format.`);
  }
  return normalized;
}

function normalizeIban(iban) {
  if (typeof iban !== 'string') throw new Error('Geben Sie eine gültige IBAN an.');
  const value = iban.replace(/\s+/g, '').toUpperCase();
  if (!isValidIBAN(value)) throw new Error('Geben Sie eine gültige IBAN an.');
  return value;
}

function validateBic(bic) {
  if (typeof bic !== 'string' || (bic !== '' && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic))) {
    throw new Error('Geben Sie einen gültigen BIC an oder lassen Sie das Feld leer.');
  }
}

function buildEpcPayload(snapshot) {
  const { issuer, number, totalCents } = snapshot;
  const bic = issuer.bic.trim().toUpperCase();
  validateBic(bic);
  const name = epcText(issuer.name, 'Ausstellername', 70, true);
  const reference = epcText(number, 'Rechnungsnummer', 140, true);
  const iban = normalizeIban(issuer.iban);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 99999999999) {
    throw new Error('Der Rechnungsbetrag überschreitet die EPC-GiroCode-Grenze.');
  }
  const amount = `${Math.trunc(totalCents / 100)}.${String(totalCents % 100).padStart(2, '0')}`;
  const payload = [
    'BCD', '002', '1', 'SCT', bic, name, iban, `EUR${amount}`, '', '', reference
  ].join('\n');
  if (Buffer.byteLength(payload, 'utf8') > 331) {
    throw new Error('Die Zahlungsangaben überschreiten die EPC-GiroCode-Grenze.');
  }
  return payload;
}

async function createEpcQrCode(snapshot) {
  const payload = buildEpcPayload(snapshot);
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 360
  });
  return { payload, dataUrl };
}

module.exports = { buildEpcPayload, createEpcQrCode, normalizeIban };
