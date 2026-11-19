const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

app.commandLine.appendSwitch('lang', 'de-DE');

let storage;
let settings;
let protocolHtml;
let validateProtocolTemplate;
let isDate;
let startUpdates;
let letters;
let loadManual;
let mainWindow;
let splashWindow;
let folder;
let dataFolders = [];
let configuredFolder = null;
let protocolCss = null;
let meetingTemplate = null;
let letterTemplate = null;
let signatures = [];
let enabledModules = {};
let sidebarCollapsed = false;
let lastSeenVersion = null;
let settingsLoaded = false;
let startupError;
let startupComplete = false;
let startupReady = Promise.resolve();
let writeQueue = Promise.resolve();
let downloadedUpdate = false;

function serializeWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

function requireFolder() {
  if (!folder) throw new Error('Wählen Sie zuerst einen Datenordner in den Einstellungen aus.');
  return folder;
}

async function checkFolderAvailability(folderPath) {
  try {
    const info = await fs.stat(folderPath);
    return info.isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function updateFolderAvailability() {
  for (const item of dataFolders) {
    item.available = await checkFolderAvailability(item.path);
  }
}

async function loadFolder() {
  const config = await settings.loadSettings(settingsFile());
  dataFolders = config.dataFolders;
  configuredFolder = config.activeFolder;
  protocolCss = config.protocolCss;
  meetingTemplate = config.meetingTemplate;
  letterTemplate = config.letterTemplate;
  signatures = config.signatures;
  enabledModules = config.modules;
  sidebarCollapsed = config.sidebarCollapsed;
  lastSeenVersion = config.lastSeenVersion;
  settingsLoaded = true;

  // Refresh availability status from filesystem
  await updateFolderAvailability();

  if (!config.activeFolder) return;

  // If the active folder is unavailable, clear it and report
  const activeAvailable = await checkFolderAvailability(config.activeFolder);
  if (!activeAvailable) {
    configuredFolder = null;
    folder = null;
    startupError = 'Der gespeicherte Datenordner ist nicht verfügbar. Wählen Sie einen verfügbaren Ordner in den Einstellungen aus oder verknüpfen Sie ihn erneut.';
    return;
  }

  await storage.initializeFolder(config.activeFolder);
  folder = config.activeFolder;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function persistSettings(overrides = {}) {
  await settings.saveSettings(settingsFile(), { dataFolders, activeFolder: configuredFolder, protocolCss, meetingTemplate, letterTemplate, signatures, modules: enabledModules, sidebarCollapsed, lastSeenVersion, ...overrides });
}

async function initializeFolder(folderPath) {
  const info = await fs.stat(folderPath);
  if (!info.isDirectory()) throw new Error('Der ausgewählte Speicherort ist kein Ordner.');
  await storage.initializeFolder(folderPath);
  await storage.listMeetings(folderPath);
}

function folderRegistry() {
  return dataFolders.map(item => ({ ...item }));
}

async function readProtocolCss(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Die CSS-Datei für PDF-Dokumente konnte nicht gelesen werden: ${error.message}`);
  }
}

async function readMeetingTemplate(file) {
  let template;
  try {
    template = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Die HTML-Vorlage für Sitzungsprotokolle konnte nicht gelesen werden: ${error.message}`);
  }
  validateProtocolTemplate(template);
  return template;
}

async function readLetterTemplate(file) {
  let template;
  try { template = await fs.readFile(file, 'utf8'); }
  catch (error) { throw new Error(`Die Briefvorlage konnte nicht gelesen werden: ${error.message}`); }
  letters.validateLetterTemplate(template);
  return template;
}

async function readSignature(signature) {
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
  const type = types[path.extname(signature.path).toLowerCase()];
  if (!type) throw new Error(`Nicht unterstütztes Bildformat für Unterschrift "${signature.name}".`);
  let bytes;
  try {
    const info = await fs.stat(signature.path);
    if (!info.isFile() || !info.size || info.size > 10 * 1024 * 1024) throw new Error('Die Datei ist leer, keine reguläre Datei oder größer als 10 MB.');
    bytes = await fs.readFile(signature.path);
  }
  catch (error) { throw new Error(`Unterschrift "${signature.name}" konnte nicht gelesen werden: ${error.message}`); }
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error(`Unterschrift "${signature.name}" ist leer oder größer als 10 MB.`);
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  try {
    const url = `data:${type};base64,${bytes.toString('base64')}`;
    await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src data:">');
    const data = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(url)};
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('Ungültige Bildgröße');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png');
    })()`);
    return { name: signature.name, data };
  } catch (error) {
    throw new Error(`Unterschrift "${signature.name}" ist kein lesbares Bild: ${error.message}`);
  } finally { window.destroy(); }
}

function registerHandlers() {
  ipcMain.handle('app:startup', () => startupReady);
  ipcMain.on('app:startup-complete', event => {
    if (event.sender !== mainWindow?.webContents) return;
    if (!startupComplete) {
      startupComplete = true;
      if (!mainWindow.isDestroyed()) mainWindow.show();
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      if (startupError) {
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          message: 'Die gespeicherten Einstellungen konnten nicht vollständig geladen werden',
          detail: startupError,
          buttons: ['OK']
        }).catch(error => console.error('Fehlerdialog konnte nicht angezeigt werden:', error));
      }
    } else if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('manual:get', () => loadManual(path.join(__dirname, '../shared/generated/manual.json'), app.getVersion()));
  ipcMain.handle('changelog:get', async () => {
    const entries = JSON.parse(await fs.readFile(path.join(__dirname, '../shared/changelog.json'), 'utf8'));
    if (!Array.isArray(entries) || !entries.every(entry => entry && typeof entry.version === 'string' &&
        ((Array.isArray(entry.changes) && entry.changes.every(change => typeof change === 'string')) ||
         (Array.isArray(entry.sections) && entry.sections.length > 0 && entry.sections.every(section =>
           section && typeof section.title === 'string' && section.title.trim() &&
           Array.isArray(section.changes) && section.changes.length > 0 &&
           section.changes.every(change => typeof change === 'string' && change.trim())))))) {
      throw new Error('Der Versionsverlauf ist ungültig.');
    }
    return entries;
  });
  ipcMain.handle('changelog:should-show', () => {
    if (!settingsLoaded) throw new Error('Der Versionsverlauf konnte nicht mit den gespeicherten Einstellungen abgeglichen werden.');
    return lastSeenVersion !== app.getVersion();
  });
  ipcMain.handle('changelog:mark-seen', () => serializeWrite(async () => {
    if (!settingsLoaded) throw new Error('Die angezeigte Version konnte nicht gespeichert werden.');
    const version = app.getVersion();
    await persistSettings({ lastSeenVersion: version });
    lastSeenVersion = version;
  }));
  ipcMain.handle('update:install', event => {
    if (event.sender !== mainWindow?.webContents || !downloadedUpdate) {
      throw new Error('Es liegt kein heruntergeladenes Update zur Installation bereit.');
    }
    downloadedUpdate = false;
    require('electron-updater').autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('folder:get', () => folder || null);
  ipcMain.handle('folders:get', () => ({ dataFolders: folderRegistry(), activeFolder: configuredFolder }));
  ipcMain.handle('folder:activate', (event, selected) => serializeWrite(async () => {
    const folderToActivate = dataFolders.find(item => item.path === selected);
    if (!folderToActivate) {
      throw new Error('Der ausgewählte Datenordner ist nicht registriert.');
    }
    if (!folderToActivate.available) {
      throw new Error('Der ausgewählte Datenordner ist nicht verfügbar. Verknüpfen Sie ihn erneut oder wählen Sie einen verfügbaren Ordner aus.');
    }
    await initializeFolder(selected);
    await persistSettings({ activeFolder: selected });
    configuredFolder = selected;
    folder = selected;
    return selected;
  }));
  ipcMain.handle('folder:rename', (event, selected, name) => serializeWrite(async () => {
    if (typeof selected !== 'string' || typeof name !== 'string' || !name.trim()) {
      throw new Error('Geben Sie einen gültigen Namen für den Datenordner ein.');
    }
    const index = dataFolders.findIndex(item => item.path === selected);
    if (index === -1) throw new Error('Der Datenordner wurde nicht gefunden.');
    const nextFolders = dataFolders.map((item, itemIndex) =>
      itemIndex === index ? { ...item, name: name.trim() } : item);
    await persistSettings({ dataFolders: nextFolders });
    dataFolders = nextFolders;
    return folderRegistry();
  }));
  ipcMain.handle('folder:relink', async (event, oldPath) => {
    const folderIndex = dataFolders.findIndex(item => item.path === oldPath);
    if (folderIndex === -1) throw new Error('Der Datenordner wurde nicht gefunden.');
    const folder = dataFolders[folderIndex];
    if (folder.available) throw new Error('Der Datenordner ist verfügbar und kann nicht erneut verknüpft werden.');
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Datenordner erneut verknüpfen: "${folder.name}"`,
      buttonLabel: 'Ordner auswählen',
      properties: ['openDirectory']
    });
    if (result.canceled) return null;

    return serializeWrite(async () => {
      const newPath = result.filePaths[0];
      if (typeof newPath !== 'string' || !path.isAbsolute(newPath)) {
        throw new Error('Wählen Sie einen gültigen Datenordner aus.');
      }
      const isNewPath = !dataFolders.some((item, idx) => idx !== folderIndex && item.path === newPath);
      if (!isNewPath) {
        throw new Error('Der ausgewählte Ordner ist bereits als ein anderer Datenordner registriert.');
      }
      await initializeFolder(newPath);
      const nextFolders = dataFolders.map((item, idx) =>
        idx === folderIndex ? { ...item, path: newPath, available: true } : item);
      const nextActiveFolder = configuredFolder === oldPath ? newPath : configuredFolder;
      await persistSettings({ dataFolders: nextFolders, activeFolder: nextActiveFolder });
      dataFolders = nextFolders;
      if (configuredFolder === oldPath) {
        configuredFolder = newPath;
        folder = newPath;
      }
      return folderRegistry();
    });
  });
  ipcMain.handle('folder:unregister', (event, folderPath) => serializeWrite(async () => {
    if (typeof folderPath !== 'string') throw new Error('Der Datenordner-Pfad ist ungültig.');
    const folderIndex = dataFolders.findIndex(item => item.path === folderPath);
    if (folderIndex === -1) throw new Error('Der Datenordner wurde nicht gefunden.');

    const isActive = configuredFolder === folderPath;
    const nextFolders = dataFolders.filter((item, idx) => idx !== folderIndex);
    const nextActiveFolder = isActive ? null : configuredFolder;

    await persistSettings({ dataFolders: nextFolders, activeFolder: nextActiveFolder });
    dataFolders = nextFolders;
    if (isActive) {
      configuredFolder = null;
      folder = null;
    }
    return { dataFolders: folderRegistry(), activeFolder: nextActiveFolder };
  }));
  ipcMain.handle('modules:get', () => ({ ...enabledModules }));
  ipcMain.handle('modules:set', (event, modules) => serializeWrite(async () => {
    const nextModules = settings.validateModules(modules);
    await persistSettings({ modules: nextModules });
    enabledModules = nextModules;
    return { ...enabledModules };
  }));
  ipcMain.handle('sidebar:get', () => {
    if (!settingsLoaded) throw new Error('Die Seitenleisten-Einstellung konnte nicht geladen werden.');
    return sidebarCollapsed;
  });
  ipcMain.handle('sidebar:set', (event, value) => serializeWrite(async () => {
    if (!settingsLoaded) throw new Error('Die Seitenleisten-Einstellung konnte nicht gespeichert werden.');
    const next = settings.validateSidebarCollapsed(value);
    await persistSettings({ sidebarCollapsed: next });
    sidebarCollapsed = next;
    return sidebarCollapsed;
  }));
  ipcMain.handle('protocol-css:get', () => protocolCss);
  ipcMain.handle('protocol-css:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Gemeinsame CSS-Datei für PDF-Dokumente auswählen',
      buttonLabel: 'CSS-Datei auswählen',
      properties: ['openFile'],
      filters: [{ name: 'CSS-Dateien', extensions: ['css'] }]
    });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const selected = result.filePaths[0];
      if (typeof selected !== 'string' || !path.isAbsolute(selected) || path.extname(selected).toLowerCase() !== '.css') {
        throw new Error('Wählen Sie eine gültige CSS-Datei aus.');
      }
      await readProtocolCss(selected);
      await persistSettings({ protocolCss: selected });
      protocolCss = selected;
      return selected;
    });
  });
  ipcMain.handle('protocol-css:reset', () => serializeWrite(async () => {
    await persistSettings({ protocolCss: null });
    protocolCss = null;
  }));
  ipcMain.handle('meeting-template:get', () => meetingTemplate);
  ipcMain.handle('meeting-template:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'HTML-Vorlage für Sitzungsprotokolle auswählen',
      buttonLabel: 'HTML-Vorlage auswählen',
      properties: ['openFile'],
      filters: [{ name: 'HTML-Dateien', extensions: ['html', 'htm'] }]
    });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const selected = result.filePaths[0];
      if (typeof selected !== 'string' || !path.isAbsolute(selected) || !['.html', '.htm'].includes(path.extname(selected).toLowerCase())) {
        throw new Error('Wählen Sie eine gültige HTML-Datei aus.');
      }
      await readMeetingTemplate(selected);
      await persistSettings({ meetingTemplate: selected });
      meetingTemplate = selected;
      return selected;
    });
  });
  ipcMain.handle('meeting-template:reset', () => serializeWrite(async () => {
    await persistSettings({ meetingTemplate: null });
    meetingTemplate = null;
  }));
  ipcMain.handle('letter-settings:get', () => ({ template: letterTemplate, signatures: signatures.map(item => ({ ...item })) }));
  ipcMain.handle('letter-template:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'HTML-Vorlage für Briefe auswählen', properties: ['openFile'], filters: [{ name: 'HTML-Dateien', extensions: ['html', 'htm'] }] });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const file = result.filePaths[0];
      if (typeof file !== 'string' || !path.isAbsolute(file) || !['.html', '.htm'].includes(path.extname(file).toLowerCase())) throw new Error('Wählen Sie eine gültige HTML-Datei aus.');
      await readLetterTemplate(file);
      await persistSettings({ letterTemplate: file });
      letterTemplate = file;
      return file;
    });
  });
  ipcMain.handle('letter-template:reset', () => serializeWrite(async () => {
    await persistSettings({ letterTemplate: null });
    letterTemplate = null;
  }));
  ipcMain.handle('signatures:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Unterschrift auswählen', properties: ['openFile'], filters: [{ name: 'Bilddateien', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'] }] });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const file = result.filePaths[0];
      if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Wählen Sie eine gültige Bilddatei aus.');
      const signature = { id: randomUUID(), name: path.basename(file, path.extname(file)), path: file };
      await readSignature(signature);
      const next = [...signatures, signature];
      await persistSettings({ signatures: next });
      signatures = next;
      return signature;
    });
  });
  ipcMain.handle('signatures:remove', (event, id) => serializeWrite(async () => {
    if (!signatures.some(item => item.id === id)) throw new Error('Die Unterschrift wurde nicht gefunden.');
    const next = signatures.filter(item => item.id !== id);
    await persistSettings({ signatures: next });
    signatures = next;
    return signatures;
  }));
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Datenordner für ClubManager auswählen',
      buttonLabel: 'Ordner auswählen',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const selected = result.filePaths[0];
      if (typeof selected !== 'string' || !path.isAbsolute(selected)) {
        throw new Error('Wählen Sie einen gültigen Datenordner aus.');
      }
      await initializeFolder(selected);
      const current = dataFolders.find(item => item.path === selected);
      const nextFolders = current ? dataFolders : [...dataFolders, { path: selected, name: path.basename(selected) || selected, available: true }];
      await persistSettings({ dataFolders: nextFolders, activeFolder: selected });
      dataFolders = nextFolders;
      configuredFolder = selected;
      folder = selected;
      return folder;
    });
  });
  ipcMain.handle('meetings:list', () => storage.listMeetings(requireFolder()));
  ipcMain.handle('letters:list', () => letters.listLetters(requireFolder()));
  ipcMain.handle('letters:save', (event, letter, revision) => serializeWrite(() => letters.saveLetter(requireFolder(), letter, revision)));
  ipcMain.handle('letters:has-pdf', (event, id) => letters.hasPdf(requireFolder(), id));
  ipcMain.handle('letters:open-pdf', async (event, id) => {
    const currentFolder = requireFolder();
    if (!await letters.hasPdf(currentFolder, id)) throw new Error('Das Brief-PDF wurde nicht gefunden. Exportieren Sie es erneut.');
    const error = await shell.openPath(letters.pdfPath(currentFolder, id));
    if (error) throw new Error(`Das Brief-PDF konnte nicht geöffnet werden: ${error}`);
  });
  ipcMain.handle('letters:export', (event, letter, revision) => serializeWrite(async () => {
    const currentFolder = requireFolder();
    letters.validateLetter(letter);
    const current = (await letters.listLetters(currentFolder)).find(item => item.letter.id === letter.id);
    if (!current || current.revision !== revision) throw new Error('Der gespeicherte Brief wurde geändert. Laden Sie ihn vor dem Export erneut.');
    const images = [];
    for (const id of current.letter.signatures) {
      const signature = signatures.find(item => item.id === id);
      if (!signature) throw new Error('Eine ausgewählte Unterschrift ist nicht mehr in den Einstellungen vorhanden.');
      images.push(await readSignature(signature));
    }
    const css = await readProtocolCss(protocolCss || path.join(__dirname, '../shared/letter.css'));
    const template = letterTemplate ? await readLetterTemplate(letterTemplate) : null;
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(letters.letterHtml(current.letter, css, images, template))}`);
      const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      const file = letters.pdfPath(currentFolder, current.letter.id);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await storage.atomicWrite(file, pdf);
      return file;
    } finally { pdfWindow.destroy(); }
  }));
  ipcMain.handle('meetings:save', (event, meeting, revision) =>
    serializeWrite(() => storage.saveMeeting(requireFolder(), meeting, revision)));
  ipcMain.handle('meetings:has-protocol', (event, id) => storage.hasProtocol(requireFolder(), id));
  ipcMain.handle('meetings:preview-protocol', async (event, id) => {
    const currentFolder = requireFolder();
    if (!await storage.hasProtocol(currentFolder, id)) {
      throw new Error('Das Protokoll-PDF wurde nicht gefunden. Exportieren Sie es erneut.');
    }
    return fs.readFile(storage.protocolPath(currentFolder, id));
  });
  ipcMain.handle('meetings:open-protocol', async (event, id) => {
    const currentFolder = requireFolder();
    if (!await storage.hasProtocol(currentFolder, id)) {
      throw new Error('Das Protokoll-PDF wurde nicht gefunden. Exportieren Sie es erneut.');
    }
    const error = await shell.openPath(storage.protocolPath(currentFolder, id));
    if (error) throw new Error(`Das Protokoll-PDF konnte nicht geöffnet werden: ${error}`);
  });
  ipcMain.handle('meetings:export', (event, meeting, revision, includeEarlierTasks) => serializeWrite(async () => {
    const currentFolder = requireFolder();
    storage.validateMeeting(meeting);
    if (typeof includeEarlierTasks !== 'boolean') throw new Error('Ungültige Einstellung für frühere Aufgaben.');
    const records = await storage.listMeetings(currentFolder);
    const current = records.find(item => item.meeting.id === meeting.id);
    if (!current || current.revision !== revision) {
      throw new Error('Die gespeicherte Sitzung wurde geändert. Laden Sie sie vor dem Export erneut.');
    }
    if (includeEarlierTasks && !isDate(current.meeting.date)) {
      throw new Error('Geben Sie ein gültiges Sitzungsdatum ein, um offene Aufgaben früherer Sitzungen einzubeziehen.');
    }
    const earlierMeetings = includeEarlierTasks ? records.map(record => record.meeting)
      .filter(other => other.id !== current.meeting.id && isDate(other.date) && other.date < current.meeting.date) : [];
    const css = await readProtocolCss(protocolCss || path.join(__dirname, '../shared/document.css'));
    const template = meetingTemplate ? await readMeetingTemplate(meetingTemplate) : null;
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(protocolHtml(current.meeting, css, earlierMeetings, template))}`);
      const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      const directory = path.join(currentFolder, 'meetings', 'protocols');
      await fs.mkdir(directory, { recursive: true });
      const file = storage.protocolPath(currentFolder, meeting.id);
      await storage.atomicWrite(file, pdf);
      return file;
    } finally {
      pdfWindow.destroy();
    }
  }));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  splashWindow = new BrowserWindow({
    width: 420, height: 240, frame: false, resizable: false, minimizable: false,
    maximizable: false, fullscreenable: false, show: false, backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  await splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.show();

  storage = require('./storage');
  settings = require('./settings');
  ({ protocolHtml, validateProtocolTemplate } = require('./protocol'));
  ({ isDate } = require('../shared/dates'));
  ({ startUpdates } = require('./updates'));
  letters = require('./letters');
  ({ loadManual } = require('./manual'));
  enabledModules = { ...settings.DEFAULT_MODULES };

  let updateReady;
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    updateReady = startUpdates({ updater: autoUpdater, app, dialog, getWindow: () => mainWindow, getSplashWindow: () => splashWindow, autoInstall: true });
  }

  registerHandlers();
  const folderReady = loadFolder().catch(error => { startupError = error.message; });
  startupReady = process.platform === 'linux'
    ? Promise.all([folderReady, updateReady]).then(() => {})
    : folderReady;
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 850, minHeight: 600, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  app.on('activate', () => {
    if (startupComplete && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    else if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
});

app.on('window-all-closed', () => app.quit());
