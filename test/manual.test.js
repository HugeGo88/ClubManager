const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createManual } = require('../scripts/build-manual.cjs');
const { loadManual } = require('../src/main/manual');

test('generates a manual for each supplied version and rejects empty inputs', () => {
  assert.deepEqual(createManual('1.2.3', '# Anleitung'), { version: '1.2.3', source: '# Anleitung' });
  assert.equal(createManual('1.2.4', '# Anleitung').version, '1.2.4');
  assert.throws(() => createManual('', '# Anleitung'), /Version/);
  assert.throws(() => createManual('1.2.3', '  '), /leer/);
});

test('loads only the matching version and sanitizes manual HTML', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-manual-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'manual.json');
  await assert.rejects(loadManual(file, '1.2.3'), /Handbuch konnte nicht gelesen/);
  await fs.writeFile(file, JSON.stringify(createManual('1.2.3', '# Anleitung\n\n<script>alert(1)</script>\n\n**Text**')));
  const manual = await loadManual(file, '1.2.3');
  assert.equal(manual.version, '1.2.3');
  assert.match(manual.html, /<h1>Anleitung<\/h1>/);
  assert.match(manual.html, /<strong>Text<\/strong>/);
  assert.doesNotMatch(manual.html, /<script/);
  await assert.rejects(loadManual(file, '1.2.4'), /passt nicht zur App-Version/);
  await fs.writeFile(file, '{');
  await assert.rejects(loadManual(file, '1.2.3'), /Handbuch konnte nicht gelesen/);
  await fs.writeFile(file, JSON.stringify({ version: '1.2.3', source: '' }));
  await assert.rejects(loadManual(file, '1.2.3'), /ungültig/);
});
