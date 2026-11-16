const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startUpdates } = require('../src/main/updates');

function fixture(response = 0) {
  const updater = new EventEmitter();
  let checks = 0;
  const messages = [];
  const sent = [];
  updater.checkForUpdates = async () => { checks++; };
  const window = { isDestroyed: () => false, webContents: { send: channel => sent.push(channel) } };
  const dialog = { showMessageBox: async (_, options) => { messages.push(options); return { response }; } };
  return { updater, dialog, window, messages, sent, get checks() { return checks; } };
}

test('checks for updates only in packaged supported builds', () => {
  const f = fixture();
  startUpdates({ ...f, app: { isPackaged: false }, platform: 'darwin', getWindow: () => f.window });
  startUpdates({ ...f, app: { isPackaged: true }, platform: 'freebsd', getWindow: () => f.window });
  assert.equal(f.checks, 0);
  startUpdates({ ...f, app: { isPackaged: true }, platform: 'win32', getWindow: () => f.window });
  assert.equal(f.checks, 1);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
});

test('downloads and installs Ubuntu updates before startup can continue', async () => {
  const f = fixture();
  let finishDownload;
  let checks = 0;
  const download = new Promise(resolve => { finishDownload = resolve; });
  const installs = [];
  f.updater.checkForUpdates = async () => { checks++; return { downloadPromise: download }; };
  f.updater.quitAndInstall = (...args) => installs.push(args);
  const ready = startUpdates({
    ...f, app: { isPackaged: true }, platform: 'linux',
    getWindow: () => f.window, autoInstall: true
  });
  let completed = false;
  void ready.then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(completed, false);
  f.updater.emit('update-downloaded', { version: '1.2.3' });
  assert.deepEqual(installs, [[false, true]]);
  finishDownload();
  await ready;
  assert.equal(completed, true);
});

test('reports Ubuntu automatic update errors', () => {
  const f = fixture();
  const original = console.error;
  try {
    console.error = () => {};
    startUpdates({
      ...f, app: { isPackaged: true }, platform: 'linux',
      getWindow: () => f.window, autoInstall: true
    });
    f.updater.emit('error', new Error('Authentifizierung abgebrochen'));
  } finally {
    console.error = original;
  }
  assert.equal(f.messages[0].type, 'error');
  assert.equal(f.messages[0].detail, 'Authentifizierung abgebrochen');
});

test('splash displays update messages received before and after the DOM loads', () => {
  const ipcRenderer = new EventEmitter();
  let domReady;
  let element = null;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/splash-preload.js'), 'utf8'), {
    require: () => ({ ipcRenderer }),
    document: { getElementById: () => element },
    window: { addEventListener: (_event, callback) => { domReady = callback; } }
  });
  ipcRenderer.emit('splash:update-message', {}, 'Prüfe auf Updates');
  element = { textContent: '' };
  domReady();
  assert.equal(element.textContent, 'Prüfe auf Updates');
  ipcRenderer.emit('splash:update-message', {}, 'Update wird installiert');
  assert.equal(element.textContent, 'Update wird installiert');
});

test('asks before requesting installation of a downloaded update', async () => {
  for (const response of [0, 1]) {
    const f = fixture(response);
    startUpdates({ ...f, app: { isPackaged: true }, platform: 'darwin', getWindow: () => f.window });
    f.updater.emit('update-downloaded', { version: '1.2.3' });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.messages[0].message, /1\.2\.3/);
    assert.deepEqual(f.sent, response === 0 ? ['update:prepare-install'] : []);
  }
});

test('reports updater errors to the user', async () => {
  const f = fixture();
  startUpdates({ ...f, app: { isPackaged: true }, platform: 'darwin', getWindow: () => f.window });
  const original = console.error;
  try {
    console.error = () => {};
    f.updater.emit('error', new Error('Netzwerkfehler'));
  } finally {
    console.error = original;
  }
  assert.equal(f.messages[0].type, 'error');
  assert.equal(f.messages[0].detail, 'Netzwerkfehler');
});

test('handles a failed background download promise', async () => {
  const f = fixture();
  const original = console.error;
  const logged = [];
  try {
    console.error = (...args) => logged.push(args);
    f.updater.checkForUpdates = async () => ({ downloadPromise: Promise.reject(new Error('Download fehlgeschlagen')) });
    startUpdates({ ...f, app: { isPackaged: true }, platform: 'darwin', getWindow: () => f.window });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(logged[0][0], /Update-Download fehlgeschlagen/);
  } finally {
    console.error = original;
  }
});
