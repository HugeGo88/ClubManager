const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_MODULES, validateModules } = require('./settings');
const { atomicWrite } = require('./storage');

const fileFor = folder => path.join(folder, 'clubmanager-modules.json');
const encode = modules => JSON.stringify({ version: 1, modules }, null, 2) + '\n';

async function read(folder) {
  const file = fileFor(folder);
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile()) throw new Error('Die Modul-Einstellungen sind keine reguläre Datei.');
  const content = await fs.readFile(file, 'utf8');
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Die Modul-Einstellungen enthalten ungültiges JSON.');
  }
  if (!data || data.version !== 1) throw new Error('Die Modul-Einstellungen haben ein ungültiges oder nicht unterstütztes Format.');
  return validateModules(data.modules);
}

async function loadOrInitialize(folder, legacyModules) {
  try {
    const saved = await read(folder);
    if (saved !== null) return saved;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const candidates = entries.filter(entry => ['meetings', 'members', 'invoices', 'letters', 'customizations'].includes(entry.name));
    const existing = (await Promise.all(candidates.map(async entry =>
      entry.isDirectory() || (entry.isSymbolicLink() && (await fs.stat(path.join(folder, entry.name))).isDirectory())
    ))).some(Boolean);
    const modules = validateModules(existing ? legacyModules : DEFAULT_MODULES);
    const file = fileFor(folder);
    const staged = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(staged, encode(modules), { flag: 'wx' });
      try {
        await fs.link(staged, file);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const initialized = await read(folder);
        if (initialized === null) throw error;
        return initialized;
      }
    } finally {
      await fs.rm(staged, { force: true });
    }
    return modules;
  } catch (error) {
    throw new Error(`Die Modul-Einstellungen des Datenordners konnten nicht geladen oder initialisiert werden: ${error.message}`);
  }
}

async function save(folder, modules) {
  try {
    const validated = validateModules(modules);
    await atomicWrite(fileFor(folder), encode(validated));
    return validated;
  } catch (error) {
    throw new Error(`Die Modul-Einstellungen des Datenordners konnten nicht gespeichert werden: ${error.message}`);
  }
}

module.exports = { loadOrInitialize, save };
