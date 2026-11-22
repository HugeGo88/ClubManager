const dns = require('node:dns/promises');
const fs = require('node:fs/promises');

async function checkNetworkAvailableWithDnsResolve(resolve) {
  try {
    // DNS lookup to a reliable, auth-free endpoint
    // Using the provided resolve function (or dns.resolve if called directly)
    await resolve('registry.npmjs.org', 'A');
    return true;
  } catch {
    // All errors (timeout, offline, unreachable) return false, never throw
    return false;
  }
}

async function checkNetworkAvailable() {
  return checkNetworkAvailableWithDnsResolve(
    (hostname, recordType) => dns.resolve(hostname, recordType, { timeout: 5000 })
  );
}

/**
 * Load a data folder and return structured result with either folder or error.
 * Never throws; all errors are captured and returned as {error: {code, message}}.
 * Errors are non-fatal and logged for debugging.
 *
 * @param {string} folderPath - The path to the data folder to load
 * @param {Object} options - Optional dependencies for testing
 * @param {Function} options.checkFolderAvailability - Custom folder availability check
 * @param {Function} options.logger - Custom logger function
 * @returns {Promise<{folder: string} | {error: {code: string, message: string}}>}
 */
async function loadDataFolder(folderPath, options = {}) {
  const { checkFolderAvailability, logger = console.error } = options;
  
  try {
    if (!folderPath || typeof folderPath !== 'string') {
      const error = { code: 'INVALID_PATH', message: 'Ungültiger Datenordnerpfad.' };
      logger('Error loading folder:', error);
      return { error };
    }

    // Check if folder exists and is a directory
    let stats;
    try {
      stats = await fs.stat(folderPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const error = { code: 'FOLDER_NOT_FOUND', message: `Datenordner nicht gefunden: ${folderPath}` };
        logger('Error loading folder:', error);
        return { error };
      }
      throw err;
    }

    if (!stats.isDirectory()) {
      const error = { code: 'INVALID_FOLDER', message: `Der ausgewählte Speicherort ist kein Ordner: ${folderPath}` };
      logger('Error loading folder:', error);
      return { error };
    }

    // Folder is valid
    return { folder: folderPath };
  } catch (err) {
    // Catch any unexpected errors and return them as non-fatal
    const error = {
      code: 'FOLDER_LOAD_ERROR',
      message: `Der Datenordner konnte nicht geladen werden: ${err.message || 'Unbekannter Fehler'}`
    };
    logger('Error loading folder:', error, err);
    return { error };
  }
}

module.exports = { checkNetworkAvailable, checkNetworkAvailableWithDnsResolve, loadDataFolder };
