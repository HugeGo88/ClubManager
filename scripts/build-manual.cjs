const fs = require('node:fs');
const path = require('node:path');

function createManual(version, source) {
  if (typeof version !== 'string' || !version.trim()) throw new Error('Die App-Version fehlt.');
  if (typeof source !== 'string' || !source.trim()) throw new Error('Das Handbuch ist leer.');
  return { version, source };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const source = fs.readFileSync(path.join(root, 'src/shared/manual.md'), 'utf8');
  const file = path.join(root, 'src/shared/generated/manual.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(createManual(version, source), null, 2) + '\n');
  console.log(`Handbuch für Version ${version} erstellt.`);
}

module.exports = { createManual };
