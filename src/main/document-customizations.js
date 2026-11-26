const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parser: cssParser } = require('@lezer/css');
const { atomicWrite } = require('./storage');

const CUSTOMIZATION_NAMES = Object.freeze({
  protocolCss: 'pdf.css',
  meetingTemplate: 'meeting.html',
  invoiceTemplate: 'invoice.html',
  letterTemplate: 'letter.html'
});
const SIGNATURE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pathsForFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    throw new Error('Der Datenordner für Dokumentanpassungen ist ungültig.');
  }
  const directory = path.join(folder, 'customizations');
  const signaturesDirectory = path.join(directory, 'signatures');
  return {
    directory,
    protocolCss: path.join(directory, CUSTOMIZATION_NAMES.protocolCss),
    meetingTemplate: path.join(directory, CUSTOMIZATION_NAMES.meetingTemplate),
    invoiceTemplate: path.join(directory, CUSTOMIZATION_NAMES.invoiceTemplate),
    letterTemplate: path.join(directory, CUSTOMIZATION_NAMES.letterTemplate),
    signaturesDirectory,
    signaturesManifest: path.join(signaturesDirectory, 'manifest.json')
  };
}

async function copyUnlessPresent(source, destination, conflict) {
  try {
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    conflict();
  }
}

async function migrateLegacyCustomizations(folder, legacy = {}) {
  const paths = pathsForFolder(folder);
  const conflicts = [];
  const files = ['protocolCss', 'meetingTemplate', 'letterTemplate']
    .filter(key => legacy[key] != null);
  if (files.length || legacy.signatures?.length) {
    await fs.mkdir(paths.directory, { recursive: true });
  }
  for (const key of files) {
    const source = legacy[key];
    if (typeof source !== 'string' || !path.isAbsolute(source)) {
      throw new Error(`Der alte Pfad für ${key} ist ungültig.`);
    }
    const extension = path.extname(source).toLowerCase();
    const allowedExtensions = key === 'protocolCss' ? ['.css'] : ['.html', '.htm'];
    if (!allowedExtensions.includes(extension)) {
      throw new Error(`Das Dateiformat der alten Anpassung ${key} ist ungültig.`);
    }
    await copyUnlessPresent(source, paths[key], () => conflicts.push(key));
  }

  if (legacy.signatures?.length) {
    await fs.mkdir(paths.signaturesDirectory, { recursive: true });
    try {
      await fs.lstat(paths.signaturesManifest);
      conflicts.push('signatures');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const signatures = [];
      for (const signature of legacy.signatures) {
        if (!signature || typeof signature.id !== 'string' || !ID.test(signature.id) ||
            typeof signature.name !== 'string' || !signature.name.trim() ||
            typeof signature.path !== 'string' || !path.isAbsolute(signature.path)) {
          throw new Error('Die alte Unterschriftenbibliothek ist ungültig.');
        }
        const extension = path.extname(signature.path).toLowerCase();
        if (!SIGNATURE_TYPES.has(extension)) {
          throw new Error(`Nicht unterstütztes Bildformat für Unterschrift "${signature.name}".`);
        }
        const file = `${signature.id}${extension}`;
        await copyUnlessPresent(signature.path, path.join(paths.signaturesDirectory, file),
          () => conflicts.push(`signature:${signature.id}`));
        signatures.push({ id: signature.id, name: signature.name, file });
      }
      await fs.writeFile(paths.signaturesManifest, JSON.stringify({ version: 1, signatures }, null, 2) + '\n', { flag: 'wx' });
    }
  }
  return { conflicts };
}

async function customizationPath(folder, key) {
  const paths = pathsForFolder(folder);
  if (!Object.hasOwn(CUSTOMIZATION_NAMES, key)) throw new Error('Unbekannte Dokumentanpassung.');
  const file = paths[key];
  try {
    const info = await fs.lstat(file);
    if (!info.isFile()) throw new Error('Die Dokumentanpassung ist keine reguläre Datei.');
    return file;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function importCustomization(folder, key, source, validate) {
  const paths = pathsForFolder(folder);
  if (!Object.hasOwn(CUSTOMIZATION_NAMES, key) || typeof source !== 'string' || !path.isAbsolute(source)) {
    throw new Error('Wählen Sie eine gültige Datei für die Dokumentanpassung aus.');
  }
  const expectedExtension = key === 'protocolCss' ? ['.css'] : ['.html', '.htm'];
  if (!expectedExtension.includes(path.extname(source).toLowerCase())) {
    throw new Error('Das Dateiformat passt nicht zur ausgewählten Dokumentanpassung.');
  }
  const content = await fs.readFile(source, 'utf8');
  if (!content.trim()) throw new Error('Die Datei für die Dokumentanpassung ist leer.');
  if (key === 'protocolCss') {
    let hasSyntaxError = false;
    cssParser.parse(content).iterate({
      enter(node) {
        if (node.type.isError) hasSyntaxError = true;
      }
    });
    if (hasSyntaxError) throw new Error('Die CSS-Datei enthält ungültige Syntax.');
  }
  if (validate) await validate(content);
  await fs.mkdir(paths.directory, { recursive: true });
  await atomicWrite(paths[key], content);
  return paths[key];
}

async function resetCustomization(folder, key) {
  const paths = pathsForFolder(folder);
  if (!Object.hasOwn(CUSTOMIZATION_NAMES, key)) throw new Error('Unbekannte Dokumentanpassung.');
  try {
    await fs.unlink(paths[key]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function loadSignatures(folder) {
  const paths = pathsForFolder(folder);
  let content;
  try {
    content = await fs.readFile(paths.signaturesManifest, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Die Unterschriftenbibliothek enthält ungültiges JSON.');
  }
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.signatures) ||
      manifest.signatures.some(item => !item || typeof item.id !== 'string' || !ID.test(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || typeof item.file !== 'string' ||
        path.basename(item.file) !== item.file || !SIGNATURE_TYPES.has(path.extname(item.file).toLowerCase())) ||
      new Set(manifest.signatures.map(item => item.id)).size !== manifest.signatures.length) {
    throw new Error('Die Unterschriftenbibliothek ist ungültig.');
  }
  return manifest.signatures.map(({ id, name, file }) => ({
    id, name, path: path.join(paths.signaturesDirectory, file)
  }));
}

async function importSignature(folder, source, validate) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) {
    throw new Error('Wählen Sie eine gültige Unterschrift aus.');
  }
  const extension = path.extname(source).toLowerCase();
  if (!SIGNATURE_TYPES.has(extension)) throw new Error('Nicht unterstütztes Bildformat für Unterschrift.');
  const paths = pathsForFolder(folder);
  const signature = { id: randomUUID(), name: path.basename(source, path.extname(source)) };
  const file = `${signature.id}${extension}`;
  const destination = path.join(paths.signaturesDirectory, file);
  if (validate) await validate({ ...signature, path: source });
  const bytes = await fs.readFile(source);
  await fs.mkdir(paths.signaturesDirectory, { recursive: true });
  await atomicWrite(destination, bytes);
  const signatures = await loadSignatures(folder);
  signatures.push({ ...signature, path: destination });
  await atomicWrite(paths.signaturesManifest, JSON.stringify({
    version: 1,
    signatures: signatures.map(({ id, name, path: filePath }) => ({
      id, name, file: path.basename(filePath)
    }))
  }, null, 2) + '\n');
  return { ...signature, path: destination };
}

async function removeSignature(folder, id) {
  const paths = pathsForFolder(folder);
  const signatures = await loadSignatures(folder);
  const signature = signatures.find(item => item.id === id);
  if (!signature) throw new Error('Die Unterschrift wurde nicht gefunden.');
  const remaining = signatures.filter(item => item.id !== id);
  await atomicWrite(paths.signaturesManifest, JSON.stringify({
    version: 1,
    signatures: remaining.map(({ id: signatureId, name, path: filePath }) => ({
      id: signatureId, name, file: path.basename(filePath)
    }))
  }, null, 2) + '\n');
  await fs.unlink(signature.path);
  return remaining;
}

module.exports = {
  pathsForFolder,
  migrateLegacyCustomizations,
  customizationPath,
  importCustomization,
  resetCustomization,
  loadSignatures,
  importSignature,
  removeSignature
};
