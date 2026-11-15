const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { initializeFolder } = require('../src/main/storage');
const { saveLetter, listLetters, validateLetter, validateLetterTemplate, letterHtml } = require('../src/main/letters');

function letter() {
  return { id: crypto.randomUUID(), title: 'Hallo <Welt>', date: '2026-11-15', includeAddress: true,
    address: { name: 'Alex & Sam', company: 'Firma <Beispiel>', street: 'Beispielstraße 1', postalCode: '01234', city: 'Musterstadt' },
    content: '**Hallo** <script>bad()</script>', signatures: [crypto.randomUUID()] };
}

test('saves and loads letters and detects on-disk conflicts', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-letter-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const value = letter();
  const revision = await saveLetter(folder, value, null);
  assert.deepEqual(await listLetters(folder), [{ letter: value, revision }]);
  await assert.rejects(saveLetter(folder, value, null), /Datenträger geändert/);
  await fs.unlink(path.join(folder, 'letters', `${value.id}.json`));
  await assert.rejects(saveLetter(folder, value, revision), /Datenträger geändert/);
});

test('validates letter fields and safely renders templates and optional sections', () => {
  const value = letter();
  const signature = { name: 'Alex & Sam', data: 'data:image/png;base64,abc' };
  const template = '<main>{{address}}<h1>{{title}}</h1><p>{{date}}</p>{{content}}{{signatures}}</main>';
  validateLetter(value);
  validateLetterTemplate(template);
  const html = letterHtml(value, '', [signature], template);
  assert.match(html, /Firma &lt;Beispiel&gt;<br>Alex &amp; Sam<br>Beispielstraße 1<br>01234 Musterstadt/);
  assert.match(html, /Hallo &lt;Welt&gt;/);
  assert.match(html, /<strong>Hallo<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /letter-signature/);
  assert.doesNotMatch(letterHtml({ ...value, includeAddress: false }, '', []), /<div class="letter-(address|signatures)"/);
  assert.throws(() => validateLetterTemplate('<p>{{unknown}}</p>'), /Unbekannter Platzhalter/);
  assert.throws(() => validateLetter({ ...value, signatures: [value.signatures[0], value.signatures[0]] }), /Briefdaten/);
  assert.throws(() => validateLetter({ ...value, date: '2026-02-30' }), /Briefdaten/);
  assert.throws(() => validateLetter({ ...value, address: { ...value.address, postalCode: 1234 } }), /Briefdaten/);
  const partial = { ...value, address: { name: '', company: '', street: '', postalCode: '', city: 'Musterstadt' } };
  assert.match(letterHtml(partial, '', []), /<div class="letter-address">Musterstadt<\/div>/);
  assert.doesNotMatch(letterHtml({ ...partial, address: { ...partial.address, city: '' } }, '', []), /class="letter-address"/);
});

test('preserves legacy multiline addresses when loading, rendering and saving', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-letter-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await initializeFolder(folder);
  const value = { ...letter(), address: 'Firma\nAlex Beispiel\nHauptstraße 1\n01234 Musterstadt' };
  const originalRevision = await saveLetter(folder, value, null);
  const [record] = await listLetters(folder);
  assert.equal(record.revision, originalRevision);
  assert.deepEqual(record.letter.address, { name: value.address, company: '', street: '', postalCode: '', city: '' });
  assert.match(letterHtml(record.letter, '', []), /Firma<br>Alex Beispiel<br>Hauptstraße 1<br>01234 Musterstadt/);
  const newRevision = await saveLetter(folder, record.letter, record.revision);
  assert.deepEqual(await listLetters(folder), [{ letter: record.letter, revision: newRevision }]);
});

test('example template renders all letter sections', async () => {
  const template = await fs.readFile(path.join(__dirname, '../docs/letter-template-example.html'), 'utf8');
  validateLetterTemplate(template);
  const html = letterHtml(letter(), '', [{ name: 'Alex', data: 'data:image/png;base64,abc' }], template);
  assert.match(html, /letter-address/);
  assert.match(html, /<strong>Hallo<\/strong>/);
  assert.match(html, /<figcaption>Alex<\/figcaption>/);
  assert.doesNotMatch(html, /\{\{/);
});
