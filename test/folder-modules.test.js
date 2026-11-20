const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadOrInitialize, save } = require('../src/main/folder-modules');
const { loadOrSaveName, saveName } = require('../src/main/folder-name');
const { saveSettings, loadSettings } = require('../src/main/settings');

test('new and previously initialized folders get the appropriate independent selection', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fresh = path.join(root, 'fresh');
  const existing = path.join(root, 'existing');
  await fs.mkdir(fresh);
  await fs.mkdir(existing);
  await fs.writeFile(path.join(fresh, 'unrelated.txt'), 'unrelated');
  await fs.writeFile(path.join(fresh, 'letters'), 'not a ClubManager directory');
  await fs.mkdir(path.join(existing, 'meetings'));
  const legacy = { meetings: false, members: true, invoices: false, letters: true };
  assert.deepEqual(await loadOrInitialize(fresh, legacy), { meetings: true, members: false, invoices: false, letters: false });
  assert.deepEqual(await loadOrInitialize(existing, legacy), legacy);
  assert.deepEqual(await loadOrInitialize(existing, { meetings: true, members: false, invoices: false, letters: false }), legacy);
});

test('rejects invalid and unreadable settings without replacing them, and retains saved selection on failed writes', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'clubmanager-modules.json');
  const legacy = { meetings: false, members: true, invoices: true, letters: false };
  for (const invalid of ['{', JSON.stringify({ version: 2, modules: legacy }), JSON.stringify({ version: 1, modules: { meetings: true } })]) {
    await fs.writeFile(file, invalid);
    await assert.rejects(loadOrInitialize(root, legacy), /Modul-Einstellungen/);
    assert.equal(await fs.readFile(file, 'utf8'), invalid);
  }
  await fs.rm(file);
  await fs.mkdir(file);
  await assert.rejects(loadOrInitialize(root, legacy), /Modul-Einstellungen/);
  await assert.rejects(save(root, legacy), /Modul-Einstellungen/);
  await fs.rmdir(file);
  await save(root, legacy);
  await assert.rejects(save(root, { ...legacy, meetings: 'yes' }), /Modul-Einstellungen/);
  assert.deepEqual(await loadOrInitialize(root, legacy), legacy);
});

test('concurrent first initialization preserves the winner', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'meetings'));
  const first = { meetings: true, members: false, invoices: false, letters: false };
  const second = { meetings: false, members: true, invoices: true, letters: true };
  const results = await Promise.all([loadOrInitialize(root, first), loadOrInitialize(root, second)]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(await loadOrInitialize(root, first), results[0]);
});

test('later legacy migrations remain independent of edited folders and display names', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = path.join(root, 'first');
  const later = path.join(root, 'later');
  await fs.mkdir(path.join(first, 'meetings'), { recursive: true });
  await fs.mkdir(path.join(later, 'letters'), { recursive: true });
  const settingsFile = path.join(root, 'settings.json');
  const legacy = { meetings: false, members: true, invoices: true, letters: false };
  await saveSettings(settingsFile, { modules: legacy, sidebarCollapsed: true });
  await loadOrSaveName(first, 'Verein A');
  assert.deepEqual(await loadOrInitialize(first, (await loadSettings(settingsFile)).modules), legacy);
  const changed = { meetings: true, members: false, invoices: false, letters: true };
  await save(first, changed);
  await saveName(first, 'Neuer Name');
  assert.deepEqual(await loadOrInitialize(first, legacy), changed);
  assert.equal(await loadOrSaveName(first, 'fallback'), 'Neuer Name');
  assert.deepEqual(await loadOrInitialize(later, (await loadSettings(settingsFile)).modules), legacy);
  assert.equal((await loadSettings(settingsFile)).sidebarCollapsed, true);
});
