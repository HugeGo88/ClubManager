const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage');

const DEFAULT_MODULES = Object.freeze({ meetings: true, members: false, invoices: false, letters: false });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSignatures(signatures) {
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

async function loadSettings(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { folder: null, protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [], modules: { ...DEFAULT_MODULES }, sidebarCollapsed: false, lastSeenVersion: null };
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
  for (const [key, label] of [['folder', 'Datenordner'], ['protocolCss', 'CSS-Datei'], ['meetingTemplate', 'HTML-Vorlage'], ['letterTemplate', 'Briefvorlage']]) {
    if (config[key] != null && (typeof config[key] !== 'string' || !path.isAbsolute(config[key]))) {
      throw new Error(`Der gespeicherte Pfad für ${label} ist ungültig.`);
    }
  }
  const modules = config.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(config.modules);
  const sidebarCollapsed = config.sidebarCollapsed === undefined ? false : validateSidebarCollapsed(config.sidebarCollapsed);
  const signatures = config.signatures === undefined ? [] : validateSignatures(config.signatures);
  if (config.lastSeenVersion != null && (typeof config.lastSeenVersion !== 'string' || !config.lastSeenVersion.trim())) {
    throw new Error('Die gespeicherte App-Version ist ungültig.');
  }
  return { folder: config.folder ?? null, protocolCss: config.protocolCss ?? null, meetingTemplate: config.meetingTemplate ?? null, letterTemplate: config.letterTemplate ?? null, signatures, modules, sidebarCollapsed, lastSeenVersion: config.lastSeenVersion ?? null };
}

async function saveSettings(file, settings) {
  const modules = settings.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(settings.modules);
  const sidebarCollapsed = settings.sidebarCollapsed === undefined ? false : validateSidebarCollapsed(settings.sidebarCollapsed);
  const signatures = settings.signatures === undefined ? [] : validateSignatures(settings.signatures);
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
  await atomicWrite(file, JSON.stringify({ folder: settings.folder ?? null, protocolCss: settings.protocolCss ?? null, meetingTemplate: settings.meetingTemplate ?? null, letterTemplate: settings.letterTemplate ?? null, signatures, modules, sidebarCollapsed, lastSeenVersion: settings.lastSeenVersion ?? null }, null, 2) + '\n');
}

module.exports = { loadSettings, saveSettings, DEFAULT_MODULES, validateModules, validateSidebarCollapsed };
