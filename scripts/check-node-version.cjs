const fs = require('node:fs');
const path = require('node:path');

const requiredVersion = fs.readFileSync(path.join(__dirname, '../.nvmrc'), 'utf8').trim().replace(/^v/, '');
const [requiredMajor, requiredMinor, requiredPatch] = requiredVersion.split('.').map(Number);
const [currentMajor, currentMinor, currentPatch] = process.versions.node.split('.').map(Number);
const isSupported = currentMajor > requiredMajor ||
  (currentMajor === requiredMajor && (currentMinor > requiredMinor ||
    (currentMinor === requiredMinor && currentPatch >= requiredPatch)));

if (!isSupported) {
  console.error(`ClubManager checks require Node.js ${requiredVersion} or newer; found ${process.versions.node}.`);
  process.exitCode = 1;
}
