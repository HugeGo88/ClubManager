const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadOrInitialize, reload, save } = require('../src/main/folder-modules');
const { loadOrSaveName, saveName } = require('../src/main/folder-name');
const { saveSettings, loadSettings } = require('../src/main/settings');

test('a stale save leaves the external selection untouched and a reload allows a new edit', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'clubmanager-modules.json');
  const external = { meetings: false, members: true, invoices: true, letters: false };
  const initial = await loadOrInitialize(root, external);
  const bytes = JSON.stringify({ version: 1, modules: external });
  await fs.writeFile(file, bytes);
  const proposed = { ...external, letters: true };
  await assert.rejects(save(root, proposed, initial.revision), /Konflikt.*neu laden/);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  const current = await loadOrInitialize(root, external);
  await save(root, proposed, current.revision);
  assert.deepEqual((await loadOrInitialize(root, external)).modules, proposed);
});

test('deletion and byte-identical replacement are not permission to save or reinitialize', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'clubmanager-modules.json');
  const legacy = { meetings: false, members: true, invoices: true, letters: false };
  const initial = await loadOrInitialize(root, legacy);
  const bytes = await fs.readFile(file);
  await fs.rename(file, `${file}.original`);
  await assert.rejects(reload(root), /zuvor geladenen.*fehlen/);
  await assert.rejects(save(root, legacy, initial.revision), /Konflikt/);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  await fs.writeFile(file, bytes);
  await assert.rejects(save(root, legacy, initial.revision), /Konflikt/);
  assert.deepEqual(await fs.readFile(file), bytes);
  await save(root, legacy, (await reload(root)).revision);
  assert.deepEqual((await reload(root)).modules, legacy);
});

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
  assert.deepEqual((await loadOrInitialize(fresh, legacy)).modules, { meetings: true, members: false, invoices: false, letters: false });
  assert.deepEqual((await loadOrInitialize(existing, legacy)).modules, legacy);
  assert.deepEqual((await loadOrInitialize(existing, { meetings: true, members: false, invoices: false, letters: false })).modules, legacy);
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
  const initial = await loadOrInitialize(root, legacy);
  await assert.rejects(save(root, { ...legacy, meetings: 'yes' }, initial.revision), /Modul-Einstellungen/);
  assert.deepEqual(await reload(root), initial);
});

test('read and write failures surface without losing the saved configuration', async t => {
  const root = path.join(process.cwd(), `.folder-modules-test-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = { meetings: false, members: true, invoices: true, letters: false };
  const file = path.join(root, 'clubmanager-modules.json');
  const initial = await loadOrInitialize(root, legacy);
  const original = await fs.readFile(file);
  const readFile = fs.readFile;
  const read = t.mock.method(fs, 'readFile', (target, ...args) => {
    if (target === file) return Promise.reject(Object.assign(new Error('fixture read failure'), { code: 'EIO' }));
    return readFile(target, ...args);
  });
  await assert.rejects(reload(root), /fixture read failure/);
  await assert.rejects(save(root, legacy, initial.revision), /Konflikt.*fixture read failure/);
  read.mock.restore();
  const rename = fs.rename;
  const write = t.mock.method(fs, 'rename', (source, target) => {
    if (target === file) return Promise.reject(Object.assign(new Error('fixture write failure'), { code: 'EIO' }));
    return rename(source, target);
  });
  await assert.rejects(save(root, legacy, initial.revision), /nicht gespeichert.*fixture write failure/);
  write.mock.restore();
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await reload(root), initial);
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
  const initial = await loadOrInitialize(first, (await loadSettings(settingsFile)).modules);
  assert.deepEqual(initial.modules, legacy);
  const changed = { meetings: true, members: false, invoices: false, letters: true };
  await save(first, changed, initial.revision);
  await saveName(first, 'Neuer Name');
  assert.deepEqual((await loadOrInitialize(first, legacy)).modules, changed);
  assert.equal(await loadOrSaveName(first, 'fallback'), 'Neuer Name');
  assert.deepEqual((await loadOrInitialize(later, (await loadSettings(settingsFile)).modules)).modules, legacy);
  assert.equal((await loadSettings(settingsFile)).sidebarCollapsed, true);
});
