const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DEFAULT_MODULES, validateModules } = require('./settings');
const { atomicWrite } = require('./storage');

const fileFor = folder => path.join(folder, 'clubmanager-modules.json');
const encode = modules => JSON.stringify({ version: 1, modules }, null, 2) + '\n';
const identity = info => `${info.dev}:${info.ino}:${info.birthtimeNs}:${info.mtimeNs}`;
const revision = (info, content) => createHash('sha256').update(identity(info)).update('\0').update(content).digest('hex');
const missing = () => new Error('Die zuvor geladenen Modul-Einstellungen fehlen. Stellen Sie die Datei wieder her und laden Sie die Einstellungen neu.');
const conflict = reason => Object.assign(
  new Error(`Konflikt: Die Modul-Einstellungen auf dem Datenträger wurden geändert${reason ? ` (${reason})` : ''}. Bitte die Modul-Einstellungen neu laden.`),
  { code: 'MODULE_CONFLICT' }
);

async function read(folder) {
  const file = fileFor(folder);
  let info;
  try {
    info = await fs.lstat(file, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile()) throw new Error('Die Modul-Einstellungen sind keine reguläre Datei.');
  const content = await fs.readFile(file);
  const current = await fs.lstat(file, { bigint: true });
  if (identity(info) !== identity(current)) {
    throw new Error('Die Modul-Einstellungen wurden beim Lesen geändert. Bitte erneut laden.');
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Die Modul-Einstellungen enthalten ungültiges JSON.');
  }
  if (!data || data.version !== 1) throw new Error('Die Modul-Einstellungen haben ein ungültiges oder nicht unterstütztes Format.');
  return { modules: validateModules(data.modules), revision: revision(info, content) };
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
      }
    } finally {
      await fs.rm(staged, { force: true });
    }
    return await reload(folder);
  } catch (error) {
    throw new Error(`Die Modul-Einstellungen des Datenordners konnten nicht geladen oder initialisiert werden: ${error.message}`);
  }
}

async function reload(folder) {
  try {
    const saved = await read(folder);
    if (saved === null) throw missing();
    return saved;
  } catch (error) {
    throw new Error(`Die Modul-Einstellungen des Datenordners konnten nicht geladen werden: ${error.message}`);
  }
}

async function save(folder, modules, expectedRevision) {
  try {
    const validated = validateModules(modules);
    const content = encode(validated);
    const checkRevision = async () => {
      let saved;
      try {
        saved = await read(folder);
      } catch (error) {
        throw conflict(error.message);
      }
      if (!saved || saved.revision !== expectedRevision) throw conflict();
    };
    await checkRevision();
    const newRevision = await atomicWrite(fileFor(folder), content, async staged => {
      const info = await fs.lstat(staged, { bigint: true });
      await checkRevision();
      return revision(info, content);
    });
    return { modules: validated, revision: newRevision };
  } catch (error) {
    throw new Error(`Die Modul-Einstellungen des Datenordners konnten nicht gespeichert werden: ${error.message}`, { cause: error });
  }
}

module.exports = { loadOrInitialize, reload, save };
