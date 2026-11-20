const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage');

const DEFAULT_MODULES = Object.freeze({ meetings: true, members: false, invoices: false, letters: false });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateLegacySignatures(signatures) {
  if (!Array.isArray(signatures) || signatures.some(item => !item || typeof item.id !== 'string' ||
      !ID.test(item.id) || typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.path !== 'string' || !path.isAbsolute(item.path)) ||
      new Set(signatures.map(item => item.id)).size !== signatures.length) {
    throw new Error('Die Einstellungen für Unterschriften sind ungültig.');
  }
  return signatures.map(({ id, name, path: file }) => ({ id, name, path: file }));
}

function validateModules(modules) {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules) ||
      Object.keys(DEFAULT_MODULES).some(name => typeof modules[name] !== 'boolean') ||
      Object.keys(modules).some(name => !Object.hasOwn(DEFAULT_MODULES, name))) {
    throw new Error('Die Modul-Einstellungen sind ungültig.');
  }
  return { ...modules };
}

function validateSidebarCollapsed(value) {
  if (typeof value !== 'boolean') throw new Error('Die Einstellung für die Seitenleiste ist ungültig.');
  return value;
}

function validateDataFolders(dataFolders) {
  if (!Array.isArray(dataFolders) || dataFolders.some(item => !item ||
      typeof item.path !== 'string' || !path.isAbsolute(item.path) ||
      typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.available !== 'boolean' ||
      (item.moduleSettingsKnown !== undefined && typeof item.moduleSettingsKnown !== 'boolean')) ||
      new Set(dataFolders.map(item => item.path)).size !== dataFolders.length) {
    throw new Error('Die Datenordner-Liste ist ungültig.');
  }
  return dataFolders.map(({ path: folderPath, name, available, moduleSettingsKnown }) => ({
    path: folderPath, name: name.trim(), available, ...(moduleSettingsKnown ? { moduleSettingsKnown } : {})
  }));
}

function validateActiveFolder(activeFolder, dataFolders) {
  if (activeFolder != null && (typeof activeFolder !== 'string' || !path.isAbsolute(activeFolder) ||
      !dataFolders.some(item => item.path === activeFolder))) {
    throw new Error('Der aktive Datenordner ist ungültig.');
  }
  return activeFolder ?? null;
}

async function loadSettings(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { dataFolders: [], activeFolder: null, protocolCss: null, meetingTemplate: null, letterTemplate: null, legacySignatures: [], modules: { ...DEFAULT_MODULES }, sidebarCollapsed: false, lastSeenVersion: null };
  }
  let config;
  try {
    config = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Die gespeicherten Einstellungen enthalten ungültiges JSON.');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Die gespeicherten Einstellungen sind ungültig.');
  }
  for (const [key, label] of [['folder', 'Datenordner'], ['activeFolder', 'Datenordner'], ['protocolCss', 'CSS-Datei'], ['meetingTemplate', 'HTML-Vorlage'], ['letterTemplate', 'Briefvorlage']]) {
    if (config[key] != null && (typeof config[key] !== 'string' || !path.isAbsolute(config[key]))) {
      throw new Error(`Der gespeicherte Pfad für ${label} ist ungültig.`);
    }
  }
  const legacyFolder = config.folder ?? null;
  const legacyDataFolders = config.dataFolders === undefined
    ? legacyFolder ? [{ path: legacyFolder, name: path.basename(legacyFolder) || legacyFolder }] : []
    : config.dataFolders;
  const dataFolders = validateDataFolders(
    legacyDataFolders.map(item => ({
      ...item,
      available: item.available !== undefined ? item.available : true
    }))
  );
  const activeFolder = validateActiveFolder(
    config.dataFolders === undefined ? legacyFolder : config.activeFolder,
    dataFolders
  );
  const modules = config.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(config.modules);
  const sidebarCollapsed = config.sidebarCollapsed === undefined ? false : validateSidebarCollapsed(config.sidebarCollapsed);
  const legacySignatures = config.signatures === undefined ? [] : validateLegacySignatures(config.signatures);
  if (config.lastSeenVersion != null && (typeof config.lastSeenVersion !== 'string' || !config.lastSeenVersion.trim())) {
    throw new Error('Die gespeicherte App-Version ist ungültig.');
  }
  return { dataFolders, activeFolder, protocolCss: config.protocolCss ?? null, meetingTemplate: config.meetingTemplate ?? null, letterTemplate: config.letterTemplate ?? null, legacySignatures, modules, sidebarCollapsed, lastSeenVersion: config.lastSeenVersion ?? null };
}

async function saveSettings(file, settings) {
  const dataFolders = validateDataFolders(settings.dataFolders ?? []);
  const activeFolder = validateActiveFolder(settings.activeFolder, dataFolders);
  const modules = settings.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(settings.modules);
  const sidebarCollapsed = settings.sidebarCollapsed === undefined ? false : validateSidebarCollapsed(settings.sidebarCollapsed);
  if (settings.meetingTemplate != null && (typeof settings.meetingTemplate !== 'string' || !path.isAbsolute(settings.meetingTemplate))) {
    throw new Error('Der gespeicherte Pfad für HTML-Vorlage ist ungültig.');
  }
  if (settings.letterTemplate != null && (typeof settings.letterTemplate !== 'string' || !path.isAbsolute(settings.letterTemplate))) {
    throw new Error('Der gespeicherte Pfad für die Briefvorlage ist ungültig.');
  }
  if (settings.lastSeenVersion != null && (typeof settings.lastSeenVersion !== 'string' || !settings.lastSeenVersion.trim())) {
    throw new Error('Die gespeicherte App-Version ist ungültig.');
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify({ dataFolders, activeFolder, protocolCss: settings.protocolCss ?? null, meetingTemplate: settings.meetingTemplate ?? null, letterTemplate: settings.letterTemplate ?? null, modules, sidebarCollapsed, lastSeenVersion: settings.lastSeenVersion ?? null }, null, 2) + '\n');
}

module.exports = { loadSettings, saveSettings, DEFAULT_MODULES, validateModules, validateSidebarCollapsed, validateDataFolders, validateActiveFolder, validateLegacySignatures };
