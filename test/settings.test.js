const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadSettings, saveSettings } = require('../src/main/settings');

test('loads legacy settings and persists PDF CSS independently of the data folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const folder = path.join(root, 'data');
  const protocolCss = path.join(root, 'protocol.css');
  const defaultModules = { meetings: true, members: false, invoices: false, letters: false };
  assert.deepEqual(await loadSettings(file), { dataFolders: [], activeFolder: null, protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [], modules: defaultModules, sidebarCollapsed: false, lastSeenVersion: null });
  await fs.writeFile(file, JSON.stringify({ folder }));
  assert.deepEqual(await loadSettings(file), { dataFolders: [{ path: folder, name: 'data', available: true }], activeFolder: folder, protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [], modules: defaultModules, sidebarCollapsed: false, lastSeenVersion: null });
  await saveSettings(file, { dataFolders: [], activeFolder: null, protocolCss });
  assert.deepEqual(await loadSettings(file), { dataFolders: [], activeFolder: null, protocolCss, meetingTemplate: null, letterTemplate: null, signatures: [], modules: defaultModules, sidebarCollapsed: false, lastSeenVersion: null });
  await saveSettings(file, { dataFolders: [{ path: folder, name: 'data', available: true }], activeFolder: folder, protocolCss });
  assert.deepEqual(await loadSettings(file), { dataFolders: [{ path: folder, name: 'data', available: true }], activeFolder: folder, protocolCss, meetingTemplate: null, letterTemplate: null, signatures: [], modules: defaultModules, sidebarCollapsed: false, lastSeenVersion: null });
  await saveSettings(file, { dataFolders: [{ path: folder, name: 'data', available: true }], activeFolder: folder, protocolCss: null });
  assert.deepEqual(await loadSettings(file), { dataFolders: [{ path: folder, name: 'data', available: true }], activeFolder: folder, protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [], modules: defaultModules, sidebarCollapsed: false, lastSeenVersion: null });
});

test('migrates the legacy folder and persists a registered folder list with an active folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const firstPath = path.join(root, 'verein-a');
  const secondPath = path.join(root, 'verein-b');
  const firstFolder = { path: firstPath, name: 'Verein A', available: true };
  const secondFolder = { path: secondPath, name: 'Verein B', available: true };
  await fs.writeFile(file, JSON.stringify({ folder: firstPath }));

  const legacy = await loadSettings(file);
  assert.deepEqual(legacy.dataFolders, [{ path: firstPath, name: 'verein-a', available: true }]);
  assert.equal(legacy.activeFolder, firstPath);

  const rootFolder = path.parse(firstPath).root;
  await fs.writeFile(file, JSON.stringify({ folder: rootFolder }));
  assert.deepEqual((await loadSettings(file)).dataFolders, [{ path: rootFolder, name: rootFolder, available: true }]);

  await saveSettings(file, {
    ...legacy,
    dataFolders: [firstFolder, secondFolder],
    activeFolder: secondPath
  });
  const saved = await loadSettings(file);
  assert.deepEqual(saved.dataFolders, [firstFolder, secondFolder]);
  assert.equal(saved.activeFolder, secondPath);
});

test('persists and validates the sidebar preference', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  for (const sidebarCollapsed of [true, false]) {
    await saveSettings(file, { sidebarCollapsed });
    assert.equal((await loadSettings(file)).sidebarCollapsed, sidebarCollapsed);
  }
  for (const sidebarCollapsed of [null, 'true', 1]) {
    await assert.rejects(saveSettings(file, { sidebarCollapsed }), /Seitenleiste/);
    await fs.writeFile(file, JSON.stringify({ sidebarCollapsed }));
    await assert.rejects(loadSettings(file), /Seitenleiste/);
  }
});

test('persists and validates the meeting template path independently of shared CSS', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const meetingTemplate = path.join(root, 'template.html');
  const protocolCss = path.join(root, 'shared.css');
  await saveSettings(file, { meetingTemplate, protocolCss });
  assert.equal((await loadSettings(file)).meetingTemplate, meetingTemplate);
  assert.equal((await loadSettings(file)).protocolCss, protocolCss);
  await assert.rejects(saveSettings(file, { meetingTemplate: 'relative.html' }), /HTML-Vorlage/);
  await fs.writeFile(file, JSON.stringify({ meetingTemplate: 'relative.html' }));
  await assert.rejects(loadSettings(file), /HTML-Vorlage/);
});

test('persists letter templates and linked signatures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const letterTemplate = path.join(root, 'letter.html');
  const signatures = [{ id: randomUUID(), name: 'Alex', path: path.join(root, 'alex.svg') }];
  await saveSettings(file, { letterTemplate, signatures });
  assert.equal((await loadSettings(file)).letterTemplate, letterTemplate);
  assert.deepEqual((await loadSettings(file)).signatures, signatures);
  await assert.rejects(saveSettings(file, { signatures: [{ ...signatures[0], path: 'relative.svg' }] }), /Unterschriften/);
  await assert.rejects(saveSettings(file, { signatures: [signatures[0], signatures[0]] }), /Unterschriften/);
  await fs.writeFile(file, JSON.stringify({ letterTemplate: 'relative.html' }));
  await assert.rejects(loadSettings(file), /Briefvorlage/);
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

test('persists and validates the last seen version', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  await saveSettings(file, { lastSeenVersion: '0.1.2' });
  assert.equal((await loadSettings(file)).lastSeenVersion, '0.1.2');
  await assert.rejects(saveSettings(file, { lastSeenVersion: '' }), /App-Version/);
  await fs.writeFile(file, JSON.stringify({ lastSeenVersion: 12 }));
  await assert.rejects(loadSettings(file), /App-Version/);
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

test('tracks and validates folder availability, with defaults for legacy migrations', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const folderA = path.join(root, 'verein-a');
  const folderB = path.join(root, 'verein-b');

  // Legacy folder defaults to available: true when migrated
  await fs.writeFile(file, JSON.stringify({ folder: folderA }));
  assert.equal((await loadSettings(file)).dataFolders[0].available, true);

  // Explicit available states are preserved
  const folders = [
    { path: folderA, name: 'Verein A', available: true },
    { path: folderB, name: 'Verein B', available: false }
  ];
  await saveSettings(file, { dataFolders: folders, activeFolder: folderA });
  const saved = await loadSettings(file);
  assert.deepEqual(saved.dataFolders, folders);

  // Invalid availability values reject
  await fs.writeFile(file, JSON.stringify({
    dataFolders: [{ ...folders[0], available: 'yes' }]
  }));
  await assert.rejects(loadSettings(file), /Datenordner-Liste/);
});
