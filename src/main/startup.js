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

/**
 * Main startup sequence orchestrator.
 * Executes the startup pipeline in strict sequential order:
 * 1. Check network availability
 * 2. Check for updates (only if online)
 * 3. Install updates (if available)
 * 4. Load data folder
 *
 * @param {Object} config - Configuration object
 * @param {Function} config.checkNetworkAvailable - Check if network is available
 * @param {Function} config.performUpdateCheck - Check if update is available (receives isOnline boolean)
 * @param {Function} config.performUpdateInstall - Install available update
 * @param {Function} config.loadDataFolder - Load data folder
 * @param {Function} config.sendSplashMessage - Send message to splash screen
 * @param {Function} config.sendSplashError - Send error message to splash screen
 *
 * @returns {Promise<{success: boolean, folder?: string, error?: {code: string, message: string}}>}
 * Never throws; all errors are captured in the result object.
 * Fatal errors (update install fails) return {success: false, error: {...}}.
 * Non-fatal errors (folder missing) return {success: false, error: {...}}.
 * Success returns {success: true, folder: path}.
 */
async function startupSequence(config) {
  const {
    checkNetworkAvailable,
    performUpdateCheck,
    performUpdateInstall,
    loadDataFolder,
    sendSplashMessage = () => {},
    sendSplashError = () => {}
  } = config;

  try {
    // Step 1: Check network
    sendSplashMessage('Prüfe Netzwerkverbindung …');
    let isOnline = false;
    try {
      isOnline = await checkNetworkAvailable();
    } catch (err) {
      // Network check should not throw, but handle gracefully if it does
      console.error('Network check error:', err);
      isOnline = false;
    }

    // Step 2: Check for updates (only if online)
    let updateAvailable = false;
    if (isOnline) {
      sendSplashMessage('Prüfe auf Updates …');
      try {
        const updateInfo = await performUpdateCheck(isOnline);
        updateAvailable = updateInfo && updateInfo.available === true;
      } catch (err) {
        // Update check errors are non-fatal
        console.error('Update check error:', err);
        updateAvailable = false;
      }
    }

    // Step 3: Install update if available (fatal if fails)
    if (updateAvailable) {
      sendSplashMessage('Neue Version wird installiert …');
      try {
        await performUpdateInstall();
        // If install succeeds, the app will restart via quitAndInstall
        // This line may not be reached
      } catch (err) {
        // Update install is fatal - return error
        const error = {
          code: err.code || 'UPDATE_INSTALL_FAILED',
          message: err.message || 'Das Update konnte nicht installiert werden.'
        };
        sendSplashError(error.code, error.message);
        return { success: false, error };
      }
    }

    // Step 4: Load data folder
    sendSplashMessage('Lade Datenordner …');
    let folderResult;
    try {
      folderResult = await loadDataFolder();
    } catch (err) {
      // Folder load errors are non-fatal
      console.error('Folder load error:', err);
      folderResult = {
        error: {
          code: 'FOLDER_LOAD_ERROR',
          message: err.message || 'Der Datenordner konnte nicht geladen werden.'
        }
      };
    }

    // Check if folder loading had an error (non-fatal)
    if (folderResult && folderResult.error) {
      sendSplashError(folderResult.error.code, folderResult.error.message);
      return { success: false, error: folderResult.error };
    }

    // All steps succeeded
    return {
      success: true,
      folder: folderResult && folderResult.folder
    };
  } catch (err) {
    // Catch any unexpected errors
    console.error('Startup sequence error:', err);
    const error = {
      code: 'STARTUP_ERROR',
      message: err.message || 'Ein unerwarteter Fehler ist während des Starts aufgetreten.'
    };
    sendSplashError(error.code, error.message);
    return { success: false, error };
  }
}

module.exports = { checkNetworkAvailable, checkNetworkAvailableWithDnsResolve, loadDataFolder, startupSequence };
