const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadDataFolder: loadDataFolderBase } = require('./startup');

app.commandLine.appendSwitch('lang', 'de-DE');

let storage;
let settings;
let protocolHtml;
let validateProtocolTemplate;
let isDate;
let startUpdates;
let letters;
let loadManual;
let documentCustomizations;
let folderName;
let folderModules;
let calendar;
let mainWindow;
let splashWindow;
let folder;
let dataFolders = [];
let folderNamesNeedCaching = false;
let folderNameCacheWarning = null;
let configuredFolder = null;
let protocolCss = null;
let meetingTemplate = null;
let letterTemplate = null;
let signatures = [];
let letterPlaceholders = [];
let letterPlaceholdersRevision = null;
let moduleSettings = { modules: {}, revision: null };
const configuredModuleFolders = new Set();
let legacyModules = {};
let sidebarCollapsed = false;
let lastSeenVersion = null;
let legacyDocumentCustomizations = { protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [] };
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
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function resolveFolderName(item) {
  try {
    return { ...item, name: await folderName.loadOrSaveName(item.path, item.name), nameWarning: null };
  } catch (error) {
    return { ...item, nameWarning: `Die Bezeichnung des Datenordners „${item.name}“ konnte nicht gelesen oder gespeichert werden: ${error.message}` };
  }
}

async function cacheFolderNames() {
  if (!folderNamesNeedCaching || hasLegacyDocumentCustomizations()) return;
  try {
    await persistSettings();
  } catch (error) {
    folderNameCacheWarning = `Die zuletzt bekannten Datenordner-Bezeichnungen konnten nicht in den Einstellungen gespeichert werden: ${error.message}`;
  }
}

async function refreshFolderRegistry() {
  const nextFolders = await Promise.all(dataFolders.map(async item => {
    const available = await checkFolderAvailability(item.path);
    return available
      ? resolveFolderName({ ...item, available })
      : { ...item, available, nameWarning: null };
  }));
  folderNamesNeedCaching ||= nextFolders.some((item, index) => item.name !== dataFolders[index].name);
  dataFolders = nextFolders;
  await cacheFolderNames();
}

function resolveRegisteredFolderName(selected) {
  const item = dataFolders.find(current => current.path === selected);
  const name = item?.name ?? (path.basename(selected).trim() || selected.trim());
  return resolveFolderName({ path: selected, name, available: true });
}

function withRegisteredFolder(item) {
  return dataFolders.some(current => current.path === item.path)
    ? dataFolders.map(current => current.path === item.path ? item : current)
    : [...dataFolders, item];
}

/**
 * Load a data folder and return structured result with either folder or error.
 * This is the main process wrapper around the startup.js function that includes
 * folder initialization logic (creating necessary structures, loading customizations).
 * Never throws; all errors are captured and returned as {error: {code, message}}.
 * 
 * @param {string} folderPath - The path to the data folder to load
 * @returns {Promise<{folder: string} | {error: {code: string, message: string}}>}
 */
async function loadDataFolder(folderPath) {
  // First check if the folder path is valid using the base function
  const baseResult = await loadDataFolderBase(folderPath);
  
  // If base check fails, return the error immediately
  if ('error' in baseResult) {
    return baseResult;
  }
  
  // Base check passed, now do full folder initialization
  try {
    // Load the folder with all its data and customizations
    // This is similar to the initializeFolder and loadFolderCustomizations logic
    const selection = await initializeFolder(folderPath);
    const customizations = await loadFolderCustomizations(folderPath);
    
    // Folder loaded successfully
    return { folder: folderPath };
  } catch (err) {
    // Catch any initialization errors and return them as non-fatal
    const error = {
      code: 'FOLDER_INIT_ERROR',
      message: `Der Datenordner konnte nicht geladen werden: ${err.message || 'Unbekannter Fehler'}`
    };
    console.error('Error initializing folder:', error, err);
    return { error };
  }
}

async function loadFolder() {
  const config = await settings.loadSettings(settingsFile());
  dataFolders = config.dataFolders;
  for (const item of dataFolders) {
    if (item.moduleSettingsKnown) configuredModuleFolders.add(item.path);
  }
  configuredFolder = config.activeFolder;
  legacyDocumentCustomizations = {
    protocolCss: config.protocolCss,
    meetingTemplate: config.meetingTemplate,
    letterTemplate: config.letterTemplate,
    signatures: config.legacySignatures
  };
  legacyModules = config.modules;
  sidebarCollapsed = config.sidebarCollapsed;
  lastSeenVersion = config.lastSeenVersion;
  settingsLoaded = true;

  // If the active folder is unavailable, clear it and report
  if (config.activeFolder && !await checkFolderAvailability(config.activeFolder)) {
    configuredFolder = null;
    folder = null;
    startupError = 'Der gespeicherte Datenordner ist nicht verfügbar. Wählen Sie einen verfügbaren Ordner in den Einstellungen aus oder verknüpfen Sie ihn erneut.';
  }

  await refreshFolderRegistry();
  if (!configuredFolder) return;

  const selectionWasKnown = configuredModuleFolders.has(config.activeFolder);
  const selection = await initializeFolder(config.activeFolder);
  const hadLegacyCustomizations = hasLegacyDocumentCustomizations();
  const conflicts = await migrateLegacyDocumentCustomizations(config.activeFolder);
  if (hadLegacyCustomizations || !selectionWasKnown) await persistSettings();
  ({ protocolCss, meetingTemplate, letterTemplate, signatures, letterPlaceholders, letterPlaceholdersRevision } =
    await loadFolderCustomizations(config.activeFolder));
  folder = config.activeFolder;
  moduleSettings = selection;
  if (conflicts.length) {
    startupError = `Bestehende Anpassungen im Datenordner wurden nicht überschrieben: ${formatCustomizationConflicts(conflicts)}`;
  }
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function persistSettings(overrides = {}) {
  await settings.saveSettings(settingsFile(), {
    activeFolder: configuredFolder,
    ...legacyDocumentCustomizations,
    modules: legacyModules, sidebarCollapsed, lastSeenVersion, ...overrides,
    dataFolders: (overrides.dataFolders ?? dataFolders).map(item => ({
      ...item, moduleSettingsKnown: configuredModuleFolders.has(item.path)
    }))
  });
  folderNamesNeedCaching = false;
  folderNameCacheWarning = null;
}

function hasLegacyDocumentCustomizations() {
  return legacyDocumentCustomizations.protocolCss !== null ||
    legacyDocumentCustomizations.meetingTemplate !== null ||
    legacyDocumentCustomizations.letterTemplate !== null ||
    legacyDocumentCustomizations.signatures.length > 0;
}

function formatCustomizationConflicts(conflicts) {
  return formatCustomizationConflictList(conflicts).join(', ');
}

function formatCustomizationConflictList(conflicts) {
  const labels = conflicts.map(conflict => {
    if (conflict === 'protocolCss') return 'PDF-CSS';
    if (conflict === 'meetingTemplate') return 'Sitzungsvorlage';
    if (conflict === 'letterTemplate') return 'Briefvorlage';
    if (conflict === 'signatures') return 'Unterschriftenbibliothek';
    if (conflict.startsWith('signature:')) return 'Unterschrift';
    return conflict;
  });
  return [...new Set(labels)];
}

async function migrateLegacyDocumentCustomizations(folderPath) {
  if (!hasLegacyDocumentCustomizations()) return [];
  if (legacyDocumentCustomizations.protocolCss) await readProtocolCss(legacyDocumentCustomizations.protocolCss);
  if (legacyDocumentCustomizations.meetingTemplate) await readMeetingTemplate(legacyDocumentCustomizations.meetingTemplate);
  if (legacyDocumentCustomizations.letterTemplate) {
    const customPlaceholders = await letters.loadLetterPlaceholders(folderPath);
    await readLetterTemplate(legacyDocumentCustomizations.letterTemplate, customPlaceholders.placeholders);
  }
  for (const signature of legacyDocumentCustomizations.signatures) await readSignature(signature);
  const { conflicts } = await documentCustomizations.migrateLegacyCustomizations(folderPath, legacyDocumentCustomizations);
  legacyDocumentCustomizations = { protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [] };
  return conflicts;
}

async function loadFolderCustomizations(folderPath) {
  const [customProtocolCss, customMeetingTemplate, customLetterTemplate, folderSignatures, folderLetterPlaceholders] = await Promise.all([
    documentCustomizations.customizationPath(folderPath, 'protocolCss'),
    documentCustomizations.customizationPath(folderPath, 'meetingTemplate'),
    documentCustomizations.customizationPath(folderPath, 'letterTemplate'),
    documentCustomizations.loadSignatures(folderPath),
    letters.loadLetterPlaceholders(folderPath)
  ]);
  return {
    protocolCss: customProtocolCss,
    meetingTemplate: customMeetingTemplate,
    letterTemplate: customLetterTemplate,
    signatures: folderSignatures,
    letterPlaceholders: folderLetterPlaceholders.placeholders,
    letterPlaceholdersRevision: folderLetterPlaceholders.revision
  };
}

async function initializeFolder(folderPath, known = configuredModuleFolders.has(folderPath)) {
  const info = await fs.stat(folderPath);
  if (!info.isDirectory()) throw new Error('Der ausgewählte Speicherort ist kein Ordner.');
  const selection = known
    ? await folderModules.reload(folderPath)
    : await folderModules.loadOrInitialize(folderPath, legacyModules);
  configuredModuleFolders.add(folderPath);
  await storage.initializeFolder(folderPath);
  await Promise.all([storage.listMeetings(folderPath), letters.listLetters(folderPath)]);
  return selection;
}

async function activateFolder(selected) {
  const selection = await initializeFolder(selected);
  const nextFolders = withRegisteredFolder(await resolveRegisteredFolderName(selected));
  const conflicts = !folder ? await migrateLegacyDocumentCustomizations(selected) : [];
  const customizations = await loadFolderCustomizations(selected);
  await persistSettings({ dataFolders: nextFolders, activeFolder: selected });
  dataFolders = nextFolders;
  configuredFolder = selected;
  folder = selected;
  moduleSettings = selection;
  ({ protocolCss, meetingTemplate, letterTemplate, signatures, letterPlaceholders, letterPlaceholdersRevision } = customizations);
  return { folder: selected, ...selection, conflicts: formatCustomizationConflictList(conflicts) };
}

function folderRegistry() {
  return {
    dataFolders: dataFolders.map(item => ({ ...item })),
    activeFolder: configuredFolder,
    nameCacheWarning: folderNameCacheWarning
  };
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

async function readLetterTemplate(file, customPlaceholders = letterPlaceholders) {
  let template;
  try { template = await fs.readFile(file, 'utf8'); }
  catch (error) { throw new Error(`Die Briefvorlage konnte nicht gelesen werden: ${error.message}`); }
  letters.validateLetterTemplate(template, customPlaceholders);
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
  ipcMain.handle('app:startup', async () => {
    await startupReady;
    return moduleSettings;
  });
  ipcMain.on('app:startup-complete', event => {
    if (event.sender !== mainWindow?.webContents) return;
    if (!startupComplete) {
      startupComplete = true;
      if (!mainWindow.isDestroyed()) mainWindow.show();
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      if (startupError) {
        const customizationConflict = startupError.startsWith('Bestehende Anpassungen');
        void dialog.showMessageBox(mainWindow, {
          type: customizationConflict ? 'warning' : 'error',
          message: customizationConflict
            ? 'Bestehende Dokumentanpassungen wurden nicht überschrieben'
            : 'Die gespeicherten Einstellungen konnten nicht vollständig geladen werden',
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
  ipcMain.handle('folders:get', () => serializeWrite(async () => {
    await refreshFolderRegistry();
    return folderRegistry();
  }));
  ipcMain.handle('folder:activate', (event, selected) => serializeWrite(async () => {
    const folderToActivate = dataFolders.find(item => item.path === selected);
    if (!folderToActivate) {
      throw new Error('Der ausgewählte Datenordner ist nicht registriert.');
    }
    if (!await checkFolderAvailability(selected)) {
      throw new Error('Der ausgewählte Datenordner ist nicht verfügbar. Verknüpfen Sie ihn erneut oder wählen Sie einen verfügbaren Ordner aus.');
    }
    return activateFolder(selected);
  }));
  ipcMain.handle('folder:rename', (event, selected, name) => serializeWrite(async () => {
    if (typeof selected !== 'string' || typeof name !== 'string' || !name.trim()) {
      throw new Error('Geben Sie einen gültigen Namen für den Datenordner ein.');
    }
    const item = dataFolders.find(item => item.path === selected);
    if (!item) throw new Error('Der Datenordner wurde nicht gefunden.');
    if (!await checkFolderAvailability(selected)) {
      throw new Error('Der Datenordner ist nicht verfügbar und kann nicht umbenannt werden.');
    }
    try {
      await folderName.saveName(selected, name.trim());
    } catch (error) {
      throw new Error(`Die Bezeichnung des Datenordners konnte nicht gespeichert werden: ${error.message}`);
    }
    dataFolders = withRegisteredFolder({ ...item, available: true, name: name.trim(), nameWarning: null });
    folderNamesNeedCaching = true;
    await cacheFolderNames();
    return folderRegistry();
  }));
  ipcMain.handle('folder:relink', async (event, oldPath) => {
    const folder = dataFolders.find(item => item.path === oldPath);
    if (!folder) throw new Error('Der Datenordner wurde nicht gefunden.');
    if (await checkFolderAvailability(oldPath)) throw new Error('Der Datenordner ist verfügbar und kann nicht erneut verknüpft werden.');
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Datenordner erneut verknüpfen: "${folder.name}"`,
      buttonLabel: 'Ordner auswählen',
      properties: ['openDirectory']
    });
    if (result.canceled) return null;

    return serializeWrite(async () => {
      const current = dataFolders.find(item => item.path === oldPath);
      if (!current) throw new Error('Der Datenordner wurde nicht gefunden.');
      if (await checkFolderAvailability(oldPath)) {
        throw new Error('Der Datenordner ist verfügbar und kann nicht erneut verknüpft werden.');
      }
      const newPath = result.filePaths[0];
      if (typeof newPath !== 'string' || !path.isAbsolute(newPath)) {
        throw new Error('Wählen Sie einen gültigen Datenordner aus.');
      }
      if (dataFolders.some(item => item.path !== oldPath && item.path === newPath)) {
        throw new Error('Der ausgewählte Ordner ist bereits als ein anderer Datenordner registriert.');
      }
      const selection = await initializeFolder(newPath, configuredModuleFolders.has(oldPath) || configuredModuleFolders.has(newPath));
      const customizations = configuredFolder === oldPath ? await loadFolderCustomizations(newPath) : null;
      const renamedFolder = await resolveFolderName({ ...current, path: newPath, available: true });
      const nextFolders = dataFolders.map(item => item.path === oldPath ? renamedFolder : item);
      const nextActiveFolder = configuredFolder === oldPath ? newPath : configuredFolder;
      await persistSettings({ dataFolders: nextFolders, activeFolder: nextActiveFolder });
      dataFolders = nextFolders;
      if (configuredFolder === oldPath) {
        configuredFolder = newPath;
        folder = newPath;
        moduleSettings = selection;
        ({ protocolCss, meetingTemplate, letterTemplate, signatures, letterPlaceholders, letterPlaceholdersRevision } = customizations);
      }
      return { ...folderRegistry(), path: newPath };
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
      protocolCss = null;
      meetingTemplate = null;
      letterTemplate = null;
      signatures = [];
      letterPlaceholders = [];
      letterPlaceholdersRevision = null;
      moduleSettings = { modules: {}, revision: null };
    }
    return folderRegistry();
  }));
  ipcMain.handle('modules:get', () => moduleSettings.modules);
  ipcMain.handle('modules:reload', () => serializeWrite(async () => {
    moduleSettings = await folderModules.reload(requireFolder());
    return moduleSettings;
  }));
  ipcMain.handle('modules:set', (event, modules, base) => serializeWrite(async () => {
    const active = requireFolder();
    if (base?.folder !== active) return { conflict: 'Der aktive Datenordner hat sich geändert. Bitte die Modul-Einstellungen neu laden.' };
    try {
      moduleSettings = await folderModules.save(active, modules, base.revision);
      return moduleSettings;
    } catch (error) {
      if (error.cause?.code === 'MODULE_CONFLICT') return { conflict: error.message };
      throw error;
    }
  }));
  ipcMain.handle('calendar:config:get', () => folder ? calendar.loadConfig(folder) : { url: null, revision: null });
  ipcMain.handle('calendar:config:set', (event, url, base) => serializeWrite(async () => {
    const active = requireFolder();
    if (base?.folder !== active) return { conflict: 'Der aktive Datenordner hat sich geändert. Bitte die Kalendereinstellungen neu laden.' };
    try {
      return await calendar.saveConfig(active, url, base.revision);
    } catch (error) {
      if (/geändert/.test(error.message)) return { conflict: error.message };
      throw error;
    }
  }));
  ipcMain.handle('calendar:fetch', async (event, base) => {
    const active = requireFolder();
    if (!base || base.folder !== active) return { stale: true };
    const config = await calendar.loadConfig(active);
    if (base.revision !== undefined && base.revision !== config.revision) {
      return { stale: true, config };
    }
    if (!config.url) return { missing: true };
    try {
      const result = await calendar.refreshCalendar(active, config, () => folder === active);
      if (result.stale) {
        if (folder !== active) return { stale: true };
        return { stale: true, config: await calendar.loadConfig(active) };
      }
      return { ...result, stale: false };
    } catch (error) {
      if (folder !== active) return { stale: true };
      const current = await calendar.loadConfig(active);
      if (current.url !== config.url || current.revision !== config.revision) {
        return { stale: true, config: current };
      }
      let cached;
      try {
        cached = await calendar.loadCache(active, config.url);
      } catch (cacheError) {
        throw new Error(`${error.message} Der gespeicherte Kalender konnte nicht verwendet werden: ${cacheError.message}`);
      }
      if (!cached) throw error;
      return { ...cached, stale: true, error: error.message };
    }
  });
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
    const currentFolder = requireFolder();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Gemeinsame CSS-Datei für PDF-Dokumente auswählen',
      buttonLabel: 'CSS-Datei importieren',
      properties: ['openFile'],
      filters: [{ name: 'CSS-Dateien', extensions: ['css'] }]
    });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const selected = result.filePaths[0];
      const imported = await documentCustomizations.importCustomization(currentFolder, 'protocolCss', selected);
      protocolCss = imported;
      return imported;
    });
  });
  ipcMain.handle('protocol-css:reset', () => serializeWrite(async () => {
    await documentCustomizations.resetCustomization(requireFolder(), 'protocolCss');
    protocolCss = null;
  }));
  ipcMain.handle('meeting-template:get', () => meetingTemplate);
  ipcMain.handle('meeting-template:choose', async () => {
    const currentFolder = requireFolder();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'HTML-Vorlage für Sitzungsprotokolle auswählen',
      buttonLabel: 'HTML-Vorlage importieren',
      properties: ['openFile'],
      filters: [{ name: 'HTML-Dateien', extensions: ['html', 'htm'] }]
    });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const selected = result.filePaths[0];
      const imported = await documentCustomizations.importCustomization(
        currentFolder, 'meetingTemplate', selected, validateProtocolTemplate);
      meetingTemplate = imported;
      return imported;
    });
  });
  ipcMain.handle('meeting-template:reset', () => serializeWrite(async () => {
    await documentCustomizations.resetCustomization(requireFolder(), 'meetingTemplate');
    meetingTemplate = null;
  }));
  ipcMain.handle('letter-settings:get', () => serializeWrite(async () => {
    if (folder) {
      const currentPlaceholders = await letters.loadLetterPlaceholders(folder);
      letterPlaceholders = currentPlaceholders.placeholders;
      letterPlaceholdersRevision = currentPlaceholders.revision;
    }
    return {
      template: letterTemplate,
      signatures: signatures.map(item => ({ ...item })),
      placeholders: letterPlaceholders.map(item => ({ ...item })),
      placeholdersRevision: letterPlaceholdersRevision
    };
  }));
  ipcMain.handle('letter-placeholders:set', (event, customPlaceholders, base) => serializeWrite(async () => {
    const active = requireFolder();
    if (base?.folder !== active) {
      throw new Error('Der aktive Datenordner hat sich geändert. Laden Sie die Briefplatzhalter neu.');
    }
    const saved = await letters.saveLetterPlaceholders(active, customPlaceholders, base.revision);
    letterPlaceholders = saved.placeholders;
    letterPlaceholdersRevision = saved.revision;
    return saved;
  }));
  ipcMain.handle('letter-template:choose', async () => {
    const currentFolder = requireFolder();
    const result = await dialog.showOpenDialog(mainWindow, { title: 'HTML-Vorlage für Briefe auswählen', properties: ['openFile'], filters: [{ name: 'HTML-Dateien', extensions: ['html', 'htm'] }] });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const file = result.filePaths[0];
      const currentPlaceholders = await letters.loadLetterPlaceholders(currentFolder);
      const imported = await documentCustomizations.importCustomization(
        currentFolder, 'letterTemplate', file,
        template => letters.validateLetterTemplate(template, currentPlaceholders.placeholders));
      letterTemplate = imported;
      letterPlaceholders = currentPlaceholders.placeholders;
      letterPlaceholdersRevision = currentPlaceholders.revision;
      return imported;
    });
  });
  ipcMain.handle('letter-template:reset', () => serializeWrite(async () => {
    await documentCustomizations.resetCustomization(requireFolder(), 'letterTemplate');
    letterTemplate = null;
  }));
  ipcMain.handle('customizations:open', async () => {
    const directory = documentCustomizations.pathsForFolder(requireFolder()).directory;
    await fs.mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(`Der Anpassungsordner konnte nicht geöffnet werden: ${error}`);
  });
  ipcMain.handle('signatures:choose', async () => {
    const currentFolder = requireFolder();
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Unterschrift auswählen', properties: ['openFile'], filters: [{ name: 'Bilddateien', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'] }] });
    if (result.canceled) return null;
    return serializeWrite(async () => {
      const file = result.filePaths[0];
      const signature = await documentCustomizations.importSignature(currentFolder, file, readSignature);
      const next = [...signatures, signature];
      signatures = next;
      return signature;
    });
  });
  ipcMain.handle('signatures:remove', (event, id) => serializeWrite(async () => {
    const next = await documentCustomizations.removeSignature(requireFolder(), id);
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
      return activateFolder(selected);
    });
  });
  ipcMain.handle('meetings:list', () => storage.listMeetings(requireFolder()));
  ipcMain.handle('letters:list', () => letters.listLetters(requireFolder()));
  ipcMain.handle('letters:save', (event, letter, revision) => serializeWrite(() => letters.saveLetter(requireFolder(), letter, revision)));
  ipcMain.handle('letters:has-pdf', (event, id) => letters.hasPdf(requireFolder(), id));
  ipcMain.handle('letters:preview-pdf', (event, id) => letters.readPdf(requireFolder(), id));
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
    const cssFile = await documentCustomizations.customizationPath(currentFolder, 'protocolCss');
    const templateFile = await documentCustomizations.customizationPath(currentFolder, 'letterTemplate');
    const currentPlaceholders = await letters.loadLetterPlaceholders(currentFolder);
    letterPlaceholders = currentPlaceholders.placeholders;
    letterPlaceholdersRevision = currentPlaceholders.revision;
    const css = await readProtocolCss(cssFile || path.join(__dirname, '../shared/letter.css'));
    const template = templateFile ? await readLetterTemplate(templateFile, letterPlaceholders) : null;
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(letters.letterHtml(current.letter, css, images, template, letterPlaceholders))}`);
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
    const cssFile = await documentCustomizations.customizationPath(currentFolder, 'protocolCss');
    const templateFile = await documentCustomizations.customizationPath(currentFolder, 'meetingTemplate');
    const css = await readProtocolCss(cssFile || path.join(__dirname, '../shared/document.css'));
    const template = templateFile ? await readMeetingTemplate(templateFile) : null;
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
  const appIcon = nativeImage.createFromPath(path.join(__dirname, '../renderer/assets/app-icon.png'));
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(appIcon);
  splashWindow = new BrowserWindow({
    width: 420, height: 240, frame: false, resizable: false, minimizable: false,
    maximizable: false, fullscreenable: false, show: false, backgroundColor: '#f5f7fa',
    icon: appIcon,
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
  documentCustomizations = require('./document-customizations');
  folderName = require('./folder-name');
  folderModules = require('./folder-modules');
  calendar = require('./calendar');
  ({ loadManual } = require('./manual'));

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
    width: 1280, height: 800, minWidth: 850, minHeight: 600, show: false, icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  app.on('activate', () => {
    if (startupComplete && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    else if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
});

app.on('window-all-closed', () => app.quit());
