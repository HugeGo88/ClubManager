const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const storage = require('./storage');
const { protocolHtml } = require('./protocol');

let mainWindow;
let folder;
let writeQueue = Promise.resolve();

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
  const configFile = path.join(app.getPath('userData'), 'settings.json');
  let content;
  try {
    content = await fs.readFile(configFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return;
  }
  let config;
  try {
    config = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Die gespeicherten Einstellungen enthalten ungültiges JSON.');
  }
  if (typeof config.folder !== 'string' || !path.isAbsolute(config.folder)) {
    throw new Error('Der gespeicherte Datenordner ist ungültig.');
  }
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

function registerHandlers() {
  ipcMain.handle('folder:get', () => folder || null);
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
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await storage.atomicWrite(path.join(app.getPath('userData'), 'settings.json'),
        JSON.stringify({ folder: selected }, null, 2) + '\n');
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
  ipcMain.handle('meetings:export', (event, meeting, revision) => serializeWrite(async () => {
    const currentFolder = requireFolder();
    storage.validateMeeting(meeting);
    const current = (await storage.listMeetings(currentFolder)).find(item => item.meeting.id === meeting.id);
    if (!current || current.revision !== revision) {
      throw new Error('Die gespeicherte Sitzung wurde geändert. Laden Sie sie vor dem Export erneut.');
    }
    const css = await fs.readFile(path.join(__dirname, '../shared/document.css'), 'utf8');
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(protocolHtml(current.meeting, css))}`);
      const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true });
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
  if (startupError) await dialog.showMessageBox(mainWindow, { type: 'error', message: 'Der gespeicherte Datenordner konnte nicht geöffnet werden', detail: startupError, buttons: ['OK'] });
  app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
});

app.on('window-all-closed', () => app.quit());
