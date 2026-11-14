const fs = require('node:fs');
const path = require('node:path');

function evaluateRelease(event, current, previous, lock, changelog) {
  if (!current || typeof current.version !== 'string') {
    throw new Error('package.json must contain a version.');
  }
  if (event === 'push') {
    if (!previous || typeof previous.version !== 'string') {
      throw new Error('The previous package.json must contain a version.');
    }
    if (previous.version === current.version) return false;
  } else if (event !== 'workflow_dispatch') {
    throw new Error(`Unsupported release event: ${event}`);
  }

  const version = current.version;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error('The package version must be a stable version (for example 1.2.3).');
  }
  if (lock?.version !== version || lock?.packages?.['']?.version !== version) {
    throw new Error('package-lock.json versions must match package.json.');
  }
  const entry = Array.isArray(changelog) && changelog.find(item => item?.version === version);
  if (!entry || !Array.isArray(entry.changes) || entry.changes.length === 0 ||
      !entry.changes.every(change => typeof change === 'string' && change.trim())) {
    throw new Error(`changelog.json must contain nonempty release notes for version ${version}.`);
  }
  return true;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (require.main === module) {
  try {
    const [event, previousFile] = process.argv.slice(2);
    const root = path.join(__dirname, '..');
    const current = readJson(path.join(root, 'package.json'));
    const previous = event === 'push' ? readJson(previousFile) : null;
    const release = evaluateRelease(event, current, previous,
      readJson(path.join(root, 'package-lock.json')),
      readJson(path.join(root, 'src/shared/changelog.json')));
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `release=${release}\n`);
    console.log(release ? `Preparing release ${current.version}.` : 'Version unchanged; skipping release.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { evaluateRelease };
