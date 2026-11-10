const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, saveSettings } = require('../src/main/settings');

test('loads legacy settings and persists PDF CSS independently of the data folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const folder = path.join(root, 'data');
  const protocolCss = path.join(root, 'protocol.css');
  assert.deepEqual(await loadSettings(file), { folder: null, protocolCss: null });
  await fs.writeFile(file, JSON.stringify({ folder }));
  assert.deepEqual(await loadSettings(file), { folder, protocolCss: null });
  await saveSettings(file, { folder: null, protocolCss });
  assert.deepEqual(await loadSettings(file), { folder: null, protocolCss });
  await saveSettings(file, { folder, protocolCss });
  assert.deepEqual(await loadSettings(file), { folder, protocolCss });
  await saveSettings(file, { folder, protocolCss: null });
  assert.deepEqual(await loadSettings(file), { folder, protocolCss: null });
});

test('rejects invalid saved settings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  for (const [content, error] of [
    ['{', /ungültiges JSON/],
    ['null', /Einstellungen sind ungültig/],
    [JSON.stringify({ folder: 'relative' }), /Datenordner/],
    [JSON.stringify({ protocolCss: 'relative.css' }), /CSS-Datei/]
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(loadSettings(file), error);
  }
});
