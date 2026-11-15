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
    address: 'Alex & Sam\nBeispielstraße 1', content: '**Hallo** <script>bad()</script>', signatures: [crypto.randomUUID()] };
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
  assert.match(html, /Alex &amp; Sam<br>Beispielstraße 1/);
  assert.match(html, /Hallo &lt;Welt&gt;/);
  assert.match(html, /<strong>Hallo<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /letter-signature/);
  assert.doesNotMatch(letterHtml({ ...value, includeAddress: false }, '', []), /<div class="letter-(address|signatures)"/);
  assert.throws(() => validateLetterTemplate('<p>{{unknown}}</p>'), /Unbekannter Platzhalter/);
  assert.throws(() => validateLetter({ ...value, signatures: [value.signatures[0], value.signatures[0]] }), /Briefdaten/);
  assert.throws(() => validateLetter({ ...value, date: '2026-02-30' }), /Briefdaten/);
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
