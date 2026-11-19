const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage');

const nameFile = folder => path.join(folder, 'clubmanager-folder.json');
const encode = name => JSON.stringify({ version: 1, name }, null, 2) + '\n';

async function readName(file) {
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile()) throw new Error('Die Namensdatei ist keine reguläre Datei.');

  const contents = await fs.readFile(file, 'utf8');
  let record;
  try {
    record = JSON.parse(contents);
  } catch {
    throw new Error('Die Namensdatei enthält ungültiges JSON.');
  }
  if (record?.version !== 1 || typeof record.name !== 'string' || !record.name.trim()) {
    throw new Error('Die Namensdatei hat ein ungültiges oder nicht unterstütztes Format.');
  }
  return record.name.trim();
}

async function loadOrSaveName(folder, fallback) {
  const file = nameFile(folder);
  const name = await readName(file);
  if (name !== null) return name;
  try {
    await fs.writeFile(file, encode(fallback), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const savedName = await readName(file);
    if (savedName !== null) return savedName;
    throw error;
  }
  return fallback;
}

async function saveName(folder, name) {
  await atomicWrite(nameFile(folder), encode(name));
}

module.exports = { loadOrSaveName, saveName };
