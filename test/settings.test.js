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
  const defaultModules = { meetings: true, members: false, invoices: false, letters: false };
  assert.deepEqual(await loadSettings(file), { folder: null, protocolCss: null, modules: defaultModules });
  await fs.writeFile(file, JSON.stringify({ folder }));
  assert.deepEqual(await loadSettings(file), { folder, protocolCss: null, modules: defaultModules });
  await saveSettings(file, { folder: null, protocolCss });
  assert.deepEqual(await loadSettings(file), { folder: null, protocolCss, modules: defaultModules });
  await saveSettings(file, { folder, protocolCss });
  assert.deepEqual(await loadSettings(file), { folder, protocolCss, modules: defaultModules });
  await saveSettings(file, { folder, protocolCss: null });
  assert.deepEqual(await loadSettings(file), { folder, protocolCss: null, modules: defaultModules });
});

test('loads, validates and persists module enablement', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const modules = { meetings: true, members: true, invoices: false, letters: true };
  await saveSettings(file, { folder: null, protocolCss: null, modules });
  assert.deepEqual((await loadSettings(file)).modules, modules);
  await assert.rejects(saveSettings(file, { modules: { ...modules, meetings: 'yes' } }), /Modul-Einstellungen/);
  await fs.writeFile(file, JSON.stringify({ modules: { ...modules, unknown: true } }));
  await assert.rejects(loadSettings(file), /Modul-Einstellungen/);
});

test('rejects invalid saved settings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  for (const [content, error] of [
    ['{', /ungültiges JSON/],
    ['null', /Einstellungen sind ungültig/],
    [JSON.stringify({ folder: 'relative' }), /Datenordner/],
    [JSON.stringify({ protocolCss: 'relative.css' }), /CSS-Datei/],
    [JSON.stringify({ modules: { meetings: true, members: false } }), /Modul-Einstellungen/]
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(loadSettings(file), error);
  }
});
