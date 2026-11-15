const fs = require('node:fs/promises');
const { markdown } = require('./protocol');

async function loadManual(file, version) {
  let manual;
  try {
    manual = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Das Handbuch konnte nicht gelesen werden: ${error.message}`);
  }
  if (!manual || manual.version !== version || typeof manual.source !== 'string' || !manual.source.trim()) {
    throw new Error('Das Handbuch ist ungültig oder passt nicht zur App-Version. Erstellen Sie die App-Ressourcen erneut.');
  }
  return { version: manual.version, html: markdown(manual.source) };
}

module.exports = { loadManual };
