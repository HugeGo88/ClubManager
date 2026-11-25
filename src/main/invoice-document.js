const Decimal = require('decimal.js');

let zugferdLibrary;

function library() {
  zugferdLibrary ??= import('@lucaapp/zugferd-ts');
  return zugferdLibrary;
}

function date(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function euro(cents) {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const UNIT_CODES = new Map([
  ['stück', 'C62'],
  ['stk', 'C62'],
  ['pauschale', 'C62'],
  ['stunde', 'HUR'],
  ['stunden', 'HUR'],
  ['std', 'HUR'],
  ['tag', 'DAY'],
  ['tage', 'DAY'],
  ['kilometer', 'KMT'],
  ['km', 'KMT']
]);

function unitCode(unit) {
  const code = UNIT_CODES.get(unit.trim().toLocaleLowerCase('de'));
  if (!code) throw new Error(`Die Einheit „${unit}“ kann nicht als EN-16931-Einheit abgebildet werden.`);
  return code;
}

function serviceDescription(invoice) {
  if (invoice.serviceDate) return null;
  return `Leistungszeitraum: ${invoice.servicePeriodStart} bis ${invoice.servicePeriodEnd}`;
}

async function buildInvoiceXml(snapshot) {
  const { InvoiceType, TaxCategoryCode, ZugferdProfile, serializeToXml } = await library();
  const { invoice, issuer } = snapshot;
  const period = serviceDescription(invoice);
  const lines = invoice.items.map((item, index) => ({
    id: String(index + 1),
    product: {
      name: item.description,
      unitCode: unitCode(item.unit),
      vatCategoryCode: TaxCategoryCode.O,
      vatRatePercent: new Decimal(0)
    },
    quantity: new Decimal(item.quantity),
    unitPrice: new Decimal(euro(item.unitPriceCents))
  }));
  const amount = new Decimal(euro(snapshot.totalCents));
  const document = {
    header: {
      id: snapshot.number,
      typeCode: InvoiceType.INVOICE,
      issueDate: date(invoice.invoiceDate),
      dueDate: date(invoice.dueDate),
      ...(invoice.serviceDate ? { deliveryDate: date(invoice.serviceDate) } : {}),
      currency: 'EUR',
      ...(period ? { note: period } : {})
    },
    seller: {
      name: issuer.name,
      address: {
        street: issuer.address.street,
        zip: issuer.address.postalCode,
        city: issuer.address.city,
        countryCode: issuer.address.countryCode
      },
      bankDetails: {
        iban: issuer.iban,
        ...(issuer.bic ? { bic: issuer.bic } : {}),
        accountName: issuer.name
      },
      ...(issuer.identifierType === 'vat'
        ? { vatId: issuer.identifier }
        : { legalRegistrationId: issuer.identifier })
    },
    buyer: {
      name: invoice.recipient.company || invoice.recipient.name,
      address: {
        street: invoice.recipient.street,
        zip: invoice.recipient.postalCode,
        city: invoice.recipient.city,
        countryCode: invoice.recipient.countryCode || 'DE'
      },
      ...(invoice.recipient.company ? { contact: { name: invoice.recipient.name } } : {})
    },
    lines,
    taxBreakdowns: [{
      categoryCode: TaxCategoryCode.O,
      ratePercent: new Decimal(0),
      basisAmount: amount,
      calculatedAmount: new Decimal(0),
      exemptionReason: 'Nicht im Anwendungsbereich der Mehrwertsteuer'
    }],
    paymentMeans: {
      typeCode: '58',
      payeeIban: issuer.iban,
      ...(issuer.bic ? { payeeBic: issuer.bic } : {}),
      payeeAccountName: issuer.name,
      paymentReference: snapshot.number
    },
    paymentTerms: { dueDate: date(invoice.dueDate) }
  };
  const xml = serializeToXml(document, ZugferdProfile.EN16931);
  const withoutOutOfScopeLineRates = xml.replace(/<ram:SpecifiedLineTradeSettlement>[\s\S]*?<\/ram:SpecifiedLineTradeSettlement>/g, settlement => {
    if (!settlement.includes('<ram:CategoryCode>O</ram:CategoryCode>')) return settlement;
    return settlement.replace(/<ram:RateApplicablePercent>[^<]*<\/ram:RateApplicablePercent>/, '');
  });
  return addBillingPeriod(withoutOutOfScopeLineRates.replace(' schemeID=""', ''), invoice);
}

async function validateInvoiceXml(xml) {
  const { validateXml } = await library();
  const result = await validateXml(xml, { profile: 'EN16931' });
  if (!result.valid) {
    const errors = result.issues.filter(issue => issue.severity === 'error')
      .map(issue => `${issue.ruleId}: ${issue.message}`);
    throw new Error(`Die EN-16931-Rechnungs-XML ist ungültig: ${errors.join(' ')}`);
  }
  return result;
}

function addBillingPeriod(xml, invoice) {
  if (!invoice.servicePeriodStart) return xml;
  const dateValue = value => value.replaceAll('-', '');
  const period = `<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${dateValue(invoice.servicePeriodStart)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${dateValue(invoice.servicePeriodEnd)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>`;
  const paymentTerms = '<ram:SpecifiedTradePaymentTerms>';
  if (!xml.includes(paymentTerms)) throw new Error('Die Rechnungs-XML enthält keinen Abrechnungsbereich für den Leistungszeitraum.');
  return xml.replace(paymentTerms, `${period}\n      ${paymentTerms}`);
}

async function embedAndValidateInvoicePdf(pdf, xml) {
  const { ZugferdProfile, embedXml, extractXml, validatePdfA } = await library();
  const result = Buffer.from(await embedXml(pdf, xml, {
    filename: 'factur-x.xml',
    profile: ZugferdProfile.EN16931,
    producer: 'ClubManager',
    creator: 'ClubManager'
  }));
  const embeddedXml = await extractXml(result);
  if (embeddedXml !== xml) throw new Error('Die Rechnungs-XML wurde nicht unverändert in das PDF eingebettet.');
  const validation = await validatePdfA(result);
  if (!validation.valid) {
    const errors = validation.issues.filter(issue => issue.severity === 'error')
      .map(issue => `${issue.ruleId}: ${issue.message}`);
    throw new Error(`Das Rechnungs-PDF besteht die PDF/A-3-Prüfung nicht: ${errors.join(' ')}`);
  }
  return result;
}

module.exports = { buildInvoiceXml, validateInvoiceXml, embedAndValidateInvoicePdf };
