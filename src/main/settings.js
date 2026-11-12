const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage');

const DEFAULT_MODULES = Object.freeze({ meetings: true, members: false, invoices: false, letters: false });

function validateModules(modules) {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules) ||
      Object.keys(DEFAULT_MODULES).some(name => typeof modules[name] !== 'boolean') ||
      Object.keys(modules).some(name => !Object.hasOwn(DEFAULT_MODULES, name))) {
    throw new Error('Die Modul-Einstellungen sind ungültig.');
  }
  return { ...modules };
}

async function loadSettings(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { folder: null, protocolCss: null, modules: { ...DEFAULT_MODULES } };
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
  for (const [key, label] of [['folder', 'Datenordner'], ['protocolCss', 'CSS-Datei']]) {
    if (config[key] != null && (typeof config[key] !== 'string' || !path.isAbsolute(config[key]))) {
      throw new Error(`Der gespeicherte Pfad für ${label} ist ungültig.`);
    }
  }
  const modules = config.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(config.modules);
  return { folder: config.folder ?? null, protocolCss: config.protocolCss ?? null, modules };
}

async function saveSettings(file, settings) {
  const modules = settings.modules === undefined ? { ...DEFAULT_MODULES } : validateModules(settings.modules);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify({ folder: settings.folder ?? null, protocolCss: settings.protocolCss ?? null, modules }, null, 2) + '\n');
}

module.exports = { loadSettings, saveSettings, DEFAULT_MODULES, validateModules };
