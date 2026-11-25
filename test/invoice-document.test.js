const test = require('node:test');
const assert = require('node:assert/strict');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const { buildInvoiceXml, validateInvoiceXml } = require('../src/main/invoice-document');
const { createEpcQrCode } = require('../src/main/invoice-epc');

function snapshot(overrides = {}) {
  return {
    number: 'RE-2026-0001',
    invoice: {
      id: 'b6f9c26e-9f4d-4c3a-a864-8e235fb91dc1',
      invoiceDate: '2026-11-24',
      serviceDate: '',
      servicePeriodStart: '2026-11-20',
      servicePeriodEnd: '2026-11-22',
      dueDate: '2026-12-08',
      recipient: {
        name: 'Alex & Sam',
        company: 'Beispielverein',
        street: 'Musterstraße 1',
        postalCode: '01234',
        city: 'Musterstadt',
        countryCode: 'DE'
      },
      items: [{ description: 'Mitgliedsbeitrag', quantity: '1.5', unit: 'Stück', unitPriceCents: 833 }]
    },
    issuer: {
      name: 'Sportverein',
      address: {
        street: 'Vereinsweg 1',
        postalCode: '12345',
        city: 'Musterstadt',
        countryCode: 'DE'
      },
      identifier: 'VR 1234',
      identifierType: 'registration',
      bankName: 'Beispielbank',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX'
    },
    totalCents: 1250,
    ...overrides
  };
}

test('builds and validates EN 16931 XML as outside VAT scope with the frozen values', async () => {
  const issued = snapshot();
  const xml = await buildInvoiceXml(issued);

  assert.match(xml, /RE-2026-0001/);
  assert.match(xml, /Mitgliedsbeitrag/);
  assert.match(xml, /Musterstra\u00dfe 1/);
  assert.match(xml, /Leistungszeitraum: 2026-11-20 bis 2026-11-22/);
  assert.match(xml, /<ram:BillingSpecifiedPeriod>\s*<ram:StartDateTime>\s*<udt:DateTimeString format="102">20261120<\/udt:DateTimeString>/);
  assert.match(xml, /<ram:EndDateTime>\s*<udt:DateTimeString format="102">20261122<\/udt:DateTimeString>\s*<\/ram:EndDateTime>\s*<\/ram:BillingSpecifiedPeriod>/);
  assert.match(xml, /<ram:CategoryCode>O<\/ram:CategoryCode>/);
  assert.doesNotMatch(xml, /<ram:CategoryCode>[SEZ]<\/ram:CategoryCode>/);
  assert.equal((await validateInvoiceXml(xml)).valid, true);
});

test('decodes the rendered EPC QR image and matches its frozen transfer payload', async () => {
  const issued = snapshot();
  const qr = await createEpcQrCode(issued);
  const png = PNG.sync.read(Buffer.from(qr.dataUrl.split(',')[1], 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

  assert.ok(decoded, 'the generated QR image must be decodable');
  assert.equal(decoded.data, qr.payload);
  assert.deepEqual(qr.payload.split('\n'), [
    'BCD', '002', '1', 'SCT', 'COBADEFFXXX', 'Sportverein', 'DE89370400440532013000',
    'EUR12.50', '', '', 'RE-2026-0001'
  ]);
});

test('rejects invalid IBANs and EPC amounts that cannot be represented', async () => {
  await assert.rejects(createEpcQrCode(snapshot({
    issuer: { ...snapshot().issuer, iban: 'DE00370400440532013000' }
  })), /IBAN/);
  await assert.rejects(createEpcQrCode(snapshot({
    issuer: { ...snapshot().issuer, iban: 'DE3600000000000' }
  })), /IBAN/);
  await assert.rejects(createEpcQrCode(snapshot({ totalCents: 100000000000 })), /EPC/);
});
