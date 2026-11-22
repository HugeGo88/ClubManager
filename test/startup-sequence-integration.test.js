const test = require('node:test');
const assert = require('node:assert/strict');

test('main.js properly imports startupSequence', () => {
  // Verify the import in main.js
  const mainContent = require('fs').readFileSync(require('path').join(__dirname, '../src/main/main.js'), 'utf8');
  assert(mainContent.includes('startupSequence'), 'startupSequence should be imported in main.js');
  assert(mainContent.includes('checkNetworkAvailable'), 'checkNetworkAvailable should be imported in main.js');
  assert(mainContent.includes('performUpdateCheck'), 'performUpdateCheck should be imported in main.js');
  assert(mainContent.includes('performUpdateInstall'), 'performUpdateInstall should be imported in main.js');
  assert(mainContent.includes('app.whenReady()'), 'app.whenReady should be in main.js');
});

test('startup.js exports startupSequence', () => {
  const startup = require('../src/main/startup');
  assert.equal(typeof startup.startupSequence, 'function');
  assert.equal(typeof startup.checkNetworkAvailable, 'function');
  assert.equal(typeof startup.loadDataFolder, 'function');
});

test('startupSequence integrates all four functions', async () => {
  const { startupSequence } = require('../src/main/startup');
  
  let callOrder = [];
  const config = {
    checkNetworkAvailable: async () => {
      callOrder.push('network');
      return true;
    },
    performUpdateCheck: async () => {
      callOrder.push('check');
      return { available: false };
    },
    performUpdateInstall: async () => {
      callOrder.push('install');
    },
    loadDataFolder: async () => {
      callOrder.push('folder');
      return { folder: '/path' };
    },
    sendSplashMessage: () => {},
    sendSplashError: () => {}
  };
  
  const result = await startupSequence(config);
  
  assert.deepEqual(callOrder, ['network', 'check', 'folder']);
  assert.equal(result.success, true);
  assert.equal(result.folder, '/path');
});

test('startupSequence skips update check when offline', async () => {
  const { startupSequence } = require('../src/main/startup');
  
  let checkCalled = false;
  const config = {
    checkNetworkAvailable: async () => false,
    performUpdateCheck: async () => {
      checkCalled = true;
      return { available: false };
    },
    performUpdateInstall: async () => {},
    loadDataFolder: async () => ({ folder: '/path' }),
    sendSplashMessage: () => {},
    sendSplashError: () => {}
  };
  
  const result = await startupSequence(config);
  
  assert.equal(checkCalled, false, 'Update check should not be called when offline');
  assert.equal(result.success, true);
});

test('startupSequence stops on update install error', async () => {
  const { startupSequence } = require('../src/main/startup');
  
  let folderCalled = false;
  const config = {
    checkNetworkAvailable: async () => true,
    performUpdateCheck: async () => ({ available: true, version: '1.0.0' }),
    performUpdateInstall: async () => {
      const error = new Error('Install failed');
      error.code = 'UPDATE_FAILED';
      throw error;
    },
    loadDataFolder: async () => {
      folderCalled = true;
      return { folder: '/path' };
    },
    sendSplashMessage: () => {},
    sendSplashError: () => {}
  };
  
  const result = await startupSequence(config);
  
  assert.equal(folderCalled, false, 'Folder should not load after install fails');
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'UPDATE_FAILED');
});
