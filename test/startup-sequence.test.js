const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startupSequence } = require('../src/main/startup');

/**
 * Test seams:
 * 1. startupSequence() orchestrator - public function that orchestrates the entire startup
 * 2. Network check - called first, determines if updates can run
 * 3. Update check - called only if network available, determines if install runs
 * 4. Update install - called only if update available, may restart app
 * 5. Folder load - called after update phase, may fail non-fatally
 * 6. Splash IPC messages - sent during startup to show progress
 * 7. Fatal error handling - update install fails → returns error
 * 8. Non-fatal error handling - folder missing → returns error but success:false
 * 9. Sequential execution - each step waits for previous
 */

function createMockUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.quitAndInstall = () => {};
  return updater;
}

function createMockSplash() {
  const messages = [];
  const errors = [];
  return {
    sendMessage: (msg) => messages.push(msg),
    sendError: (code, message) => errors.push({ code, message }),
    messages,
    errors,
    isDestroyed: () => false,
    webContents: { send: (channel, msg) => messages.push({ channel, msg }) }
  };
}

function createFixture(options = {}) {
  const updater = options.updater || createMockUpdater();
  const splash = options.splash || createMockSplash();
  const checkNetworkAvailable = options.checkNetworkAvailable || (async () => true);
  const performUpdateCheck = options.performUpdateCheck || (async () => ({ available: false }));
  const performUpdateInstall = options.performUpdateInstall || (async () => {});
  const loadDataFolder = options.loadDataFolder || (async () => ({ folder: '/path/to/data' }));
  
  const executionOrder = [];
  const wrappedCheckNetwork = async () => {
    executionOrder.push('checkNetworkAvailable');
    return checkNetworkAvailable();
  };
  const wrappedCheckUpdate = async (isOnline) => {
    executionOrder.push('performUpdateCheck');
    return performUpdateCheck(isOnline);
  };
  const wrappedInstallUpdate = async () => {
    executionOrder.push('performUpdateInstall');
    return performUpdateInstall();
  };
  const wrappedLoadFolder = async () => {
    executionOrder.push('loadDataFolder');
    return loadDataFolder();
  };
  
  return {
    updater,
    splash,
    wrappedCheckNetwork,
    wrappedCheckUpdate,
    wrappedInstallUpdate,
    wrappedLoadFolder,
    executionOrder,
    async runSequence() {
      return startupSequence({
        checkNetworkAvailable: wrappedCheckNetwork,
        performUpdateCheck: wrappedCheckUpdate,
        performUpdateInstall: wrappedInstallUpdate,
        loadDataFolder: wrappedLoadFolder,
        sendSplashMessage: (msg) => splash.sendMessage(msg),
        sendSplashError: (code, message) => splash.sendError(code, message)
      });
    }
  };
}

test('startupSequence() exists and is exported', () => {
  assert.equal(typeof startupSequence, 'function');
});

test('startupSequence() accepts config object with required functions', async () => {
  const f = createFixture();
  const result = await f.runSequence();
  assert.equal(typeof result, 'object');
  assert('success' in result);
});

// Happy path tests
test('all steps succeed - returns success with folder', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: false }),
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.equal(result.folder, '/path/to/data');
  assert.equal('error' in result, false);
});

test('all steps succeed in correct sequence: network -> check -> folder', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: false }),
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  await f.runSequence();
  
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'performUpdateCheck',
    'loadDataFolder'
  ]);
});

test('update available - install is called in sequence', async () => {
  const installCalled = [];
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {
      installCalled.push(true);
    },
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  await f.runSequence();
  
  assert.equal(installCalled.length, 1);
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'performUpdateCheck',
    'performUpdateInstall',
    'loadDataFolder'
  ]);
});

// Network offline tests
test('network offline - update check skipped, folder loads', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => false,
    performUpdateCheck: async () => { throw new Error('Should not be called'); },
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'loadDataFolder'
  ]);
});

test('network offline - returns success with folder', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => false,
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.equal(result.folder, '/path/to/data');
});

// Update check failures (non-fatal)
test('update check fails (network error) - folder load continues', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => { throw new Error('Network error'); },
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'performUpdateCheck',
    'loadDataFolder'
  ]);
});

test('update check fails - returns success (non-fatal)', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => { throw new Error('Network error'); },
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.equal(result.folder, '/path/to/data');
});

// Folder missing (non-fatal)
test('folder missing/unavailable - returns error but success:false', async () => {
  const f = createFixture({
    loadDataFolder: async () => ({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert.equal('error' in result, true);
  assert.equal(result.error.code, 'FOLDER_NOT_FOUND');
});

test('folder missing - continues after splash error shown', async () => {
  const f = createFixture({
    loadDataFolder: async () => ({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert(f.splash.errors.length > 0);
});

// Update install fails (fatal)
test('update install fails - returns error and stops', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {
      throw new Error('Installation failed');
    }
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert.equal('error' in result, true);
  assert.match(result.error.message, /Installation failed/);
});

test('update install fails - folder load not called (fatal stops execution)', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {
      throw new Error('Installation failed');
    },
    loadDataFolder: async () => { throw new Error('Should not be called'); }
  });
  
  const result = await f.runSequence();
  
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'performUpdateCheck',
    'performUpdateInstall'
  ]);
});

test('update install fails - fatal error returned with code', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {
      const error = new Error('Installation failed');
      error.code = 'UPDATE_INSTALL_FAILED';
      throw error;
    }
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'UPDATE_INSTALL_FAILED');
});

// Splash messages
test('splash messages sent during startup', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: false }),
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  await f.runSequence();
  
  assert(f.splash.messages.length > 0);
});

test('splash error message sent when folder missing', async () => {
  const f = createFixture({
    loadDataFolder: async () => ({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder missing' } })
  });
  
  await f.runSequence();
  
  assert(f.splash.errors.length > 0);
  assert.equal(f.splash.errors[0].code, 'FOLDER_NOT_FOUND');
});

// Never throws
test('startupSequence() never throws - all errors captured in result', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => { throw new Error('Unexpected error'); }
  });
  
  let threw = false;
  try {
    await f.runSequence();
  } catch {
    threw = true;
  }
  
  assert.equal(threw, false);
});

test('startupSequence() with folder error never throws', async () => {
  const f = createFixture({
    loadDataFolder: async () => { throw new Error('Unexpected error'); }
  });
  
  let threw = false;
  try {
    await f.runSequence();
  } catch {
    threw = true;
  }
  
  assert.equal(threw, false);
});

// Combined scenarios
test('network offline + folder missing - returns non-fatal error', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => false,
    loadDataFolder: async () => ({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'FOLDER_NOT_FOUND');
});

test('network available + update check fails + folder loads - returns success', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => { throw new Error('Check failed'); },
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.equal(result.folder, '/path/to/data');
});

test('update available + install succeeds + folder missing - returns non-fatal error', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {},
    loadDataFolder: async () => ({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'FOLDER_NOT_FOUND');
});

// Result structure
test('result includes success flag', async () => {
  const f = createFixture();
  const result = await f.runSequence();
  assert('success' in result);
  assert.equal(typeof result.success, 'boolean');
});

test('successful result includes folder', async () => {
  const f = createFixture({
    loadDataFolder: async () => ({ folder: '/data' })
  });
  const result = await f.runSequence();
  assert.equal(result.folder, '/data');
});

test('error result includes error object with code and message', async () => {
  const f = createFixture({
    performUpdateInstall: async () => {
      const error = new Error('Install failed');
      error.code = 'UPDATE_FAILED';
      throw error;
    },
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true })
  });
  const result = await f.runSequence();
  assert('error' in result);
  assert('code' in result.error);
  assert('message' in result.error);
});

// Update install with no downloadPromise
test('update available but no download promise - continues to folder load', async () => {
  const f = createFixture({
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.2.3' }),
    performUpdateInstall: async () => {},
    loadDataFolder: async () => ({ folder: '/path/to/data' })
  });
  
  const result = await f.runSequence();
  
  assert.equal(result.success, true);
  assert.deepEqual(f.executionOrder, [
    'checkNetworkAvailable',
    'performUpdateCheck',
    'performUpdateInstall',
    'loadDataFolder'
  ]);
});
