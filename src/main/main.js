const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const storage = require('./storage');
const settings = require('./settings');
const { protocolHtml } = require('./protocol');
const { isDate } = require('../shared/dates');
const { startUpdates } = require('./updates');

let mainWindow;
let folder;
let configuredFolder = null;
let protocolCss = null;
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

async function loadFolder() {
  const config = await settings.loadSettings(settingsFile());
  configuredFolder = config.folder;
  protocolCss = config.protocolCss;
  if (!config.folder) return;
  // Do not recreate a missing location automatically, e.g. an unmounted drive.
  let info;
  try {
    info = await fs.stat(config.folder);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Der gespeicherte Datenordner ist nicht verfügbar. Wählen Sie ihn in den Einstellungen erneut aus.');
  }
  if (!info.isDirectory()) throw new Error('Der gespeicherte Speicherort ist kein Ordner.');
  await storage.initializeFolder(config.folder);
  folder = config.folder;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function saveSettings(nextFolder, nextProtocolCss) {
  await settings.saveSettings(settingsFile(), { folder: nextFolder || null, protocolCss: nextProtocolCss });
}

async function readProtocolCss(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Die CSS-Datei für PDF-Protokolle konnte nicht gelesen werden: ${error.message}`);
  }
}

function registerHandlers() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:install', event => {
    if (event.sender !== mainWindow?.webContents || !downloadedUpdate) {
      throw new Error('Es liegt kein heruntergeladenes Update zur Installation bereit.');
    }
    downloadedUpdate = false;
    require('electron-updater').autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('folder:get', () => folder || null);
  ipcMain.handle('protocol-css:get', () => protocolCss);
  ipcMain.handle('protocol-css:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'CSS-Datei für PDF-Protokolle auswählen',
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
      await saveSettings(configuredFolder, selected);
      protocolCss = selected;
      return selected;
    });
  });
  ipcMain.handle('protocol-css:reset', () => serializeWrite(async () => {
    await saveSettings(configuredFolder, null);
    protocolCss = null;
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
      await storage.initializeFolder(selected);
      await storage.listMeetings(selected);
      await saveSettings(selected, protocolCss);
      configuredFolder = selected;
      folder = selected;
      return folder;
    });
  });
  ipcMain.handle('meetings:list', () => storage.listMeetings(requireFolder()));
  ipcMain.handle('meetings:save', (event, meeting, revision) =>
    serializeWrite(() => storage.saveMeeting(requireFolder(), meeting, revision)));
  ipcMain.handle('meetings:has-protocol', (event, id) => storage.hasProtocol(requireFolder(), id));
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
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(protocolHtml(current.meeting, css, earlierMeetings))}`);
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
  const menu = [
    ...(process.platform === 'darwin' ? [{ label: 'ClubManager', submenu: [
      { role: 'about', label: 'Über ClubManager' }, { type: 'separator' },
      { role: 'hide', label: 'ClubManager ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' },
      { role: 'unhide', label: 'Alle einblenden' }, { type: 'separator' }, { role: 'quit', label: 'ClubManager beenden' }
    ] }] : []),
    { label: 'Bearbeiten', submenu: [
      { role: 'undo', label: 'Rückgängig' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }
    ] },
    { label: 'Ansicht', submenu: [
      { role: 'reload', label: 'Neu laden' }, { role: 'toggleDevTools', label: 'Entwicklertools' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild umschalten' }
    ] },
    { label: 'Fenster', submenu: [{ role: 'minimize', label: 'Minimieren' }, { role: 'close', label: 'Schließen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  let startupError;
  try {
    await loadFolder();
  } catch (error) {
    startupError = error.message;
  }
  registerHandlers();
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 850, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (startupError) await dialog.showMessageBox(mainWindow, { type: 'error', message: 'Die gespeicherten Einstellungen konnten nicht vollständig geladen werden', detail: startupError, buttons: ['OK'] });
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', () => { downloadedUpdate = true; });
    startUpdates({ updater: autoUpdater, app, dialog, getWindow: () => mainWindow });
  }
  app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
});

app.on('window-all-closed', () => app.quit());
