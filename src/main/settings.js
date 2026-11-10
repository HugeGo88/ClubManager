const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage');

async function loadSettings(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { folder: null, protocolCss: null };
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
  return { folder: config.folder ?? null, protocolCss: config.protocolCss ?? null };
}

async function saveSettings(file, settings) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
}

module.exports = { loadSettings, saveSettings };
