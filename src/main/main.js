const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const storage = require('./storage');

let mainWindow;
let folder;
let writeQueue = Promise.resolve();

function serializeWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

function requireFolder() {
  if (!folder) throw new Error('Choose a storage folder in Settings first.');
  return folder;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function markdown(value) {
  return sanitizeHtml(marked.parse(value), {
    allowedTags: ['p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'hr'],
    allowedAttributes: {}
  });
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
  const config = JSON.parse(content);
  if (typeof config.folder !== 'string' || !path.isAbsolute(config.folder)) {
    throw new Error('The saved storage folder is invalid.');
  }
  // Do not recreate a missing location automatically, e.g. an unmounted drive.
  let info;
  try {
    info = await fs.stat(config.folder);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('The saved storage folder is unavailable. Select it again in Settings.');
  }
  if (!info.isDirectory()) throw new Error('The saved storage location is not a folder.');
  await storage.initializeFolder(config.folder);
  folder = config.folder;
}

function protocolHtml(meeting, css) {
  const attendance = meeting.attendance.map(person =>
    `<li>${escapeHtml(person.name)} — ${escapeHtml({ attending: 'Attending', excused: 'Absent with excuse', unexcused: 'Absent without excuse' }[person.status])}</li>`
  ).join('');
  const points = meeting.points.map((point, index) => `
    <section><h2>${index + 1}. ${escapeHtml(point.headline)}</h2>
    <p class="type">${escapeHtml(point.type)}</p>${markdown(point.details)}
    ${point.tasks.length ? `<h3>Tasks</h3><ul>${point.tasks.map(task =>
      `<li>${task.done ? '[Done]' : '[Open]'} ${escapeHtml(task.description)} — ${escapeHtml(task.responsible || 'Unassigned')}</li>`
    ).join('')}</ul>` : ''}</section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
    <body><h1>${escapeHtml(meeting.title)}</h1><p>${escapeHtml(meeting.date)}</p>
    <h2>Attendance</h2>${attendance ? `<ul>${attendance}</ul>` : '<p>No attendance recorded.</p>'}
    <h2>Meeting points</h2>${points || '<p>No meeting points.</p>'}</body></html>`;
}

function registerHandlers() {
  ipcMain.handle('folder:get', () => folder || null);
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a ClubManager data folder',
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
  ipcMain.handle('meetings:export', (event, meeting, revision) => serializeWrite(async () => {
    const currentFolder = requireFolder();
    storage.validateMeeting(meeting);
    const current = (await storage.listMeetings(currentFolder)).find(item => item.meeting.id === meeting.id);
    if (!current || current.revision !== revision) {
      throw new Error('The saved meeting changed. Reload it before exporting.');
    }
    const css = await fs.readFile(path.join(__dirname, '../shared/document.css'), 'utf8');
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(protocolHtml(current.meeting, css))}`);
      const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true });
      const directory = path.join(currentFolder, 'meetings', 'protocols');
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `${meeting.id}.pdf`);
      await storage.atomicWrite(file, pdf);
      return file;
    } finally {
      pdfWindow.destroy();
    }
  }));
}

app.whenReady().then(async () => {
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
  if (startupError) await dialog.showMessageBox(mainWindow, { type: 'error', message: 'Could not open the saved storage folder', detail: startupError });
  app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
});

app.on('window-all-closed', () => app.quit());
