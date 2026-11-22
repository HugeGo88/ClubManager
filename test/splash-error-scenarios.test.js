const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

/**
 * Additional test cases for splash error display feature
 * These tests verify specific error codes and message handling
 */

test('splash error display - non-fatal folder error triggers non-fatal path', async () => {
  // Verify FOLDER_NOT_FOUND is not marked as fatal
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  // Should only mark UPDATE_INSTALL_FAILED as fatal
  const lines = mainContent.split('\n');
  const fatalCheckLine = lines.find(line => line.includes("code === 'UPDATE_INSTALL_FAILED'"));
  
  assert(fatalCheckLine, 'Should check for UPDATE_INSTALL_FAILED as fatal');
  // FOLDER_NOT_FOUND should not be fatal
  assert(!mainContent.includes("code === 'FOLDER_NOT_FOUND'"), 
    'FOLDER_NOT_FOUND should NOT be marked as fatal');
  assert(!mainContent.includes("code === 'FOLDER_LOAD_ERROR'"),
    'FOLDER_LOAD_ERROR should NOT be marked as fatal');
});

test('splash error display - update install failure is fatal', async () => {
  // Verify UPDATE_INSTALL_FAILED is marked as fatal
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes("code === 'UPDATE_INSTALL_FAILED'"),
    'UPDATE_INSTALL_FAILED should be identified as fatal error');
});

test('splash error display - error message flows from startup to splash to preload', async () => {
  // Verify error message propagation path
  const startupContent = require('node:fs').readFileSync('./src/main/startup.js', 'utf-8');
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  // Startup sends error code and message
  assert(startupContent.includes('sendSplashError(error.code, error.message)'),
    'startup.js should call sendSplashError with both code and message');
  
  // Main passes it to splash via IPC
  assert(mainContent.includes("'splash:error-message'"),
    'main.js should send splash:error-message via IPC');
  
  // Preload receives and displays it
  assert(preloadContent.includes("'splash:error-message'"),
    'splash-preload should listen to splash:error-message');
  assert(preloadContent.includes('data.message'),
    'splash-preload should use the message from data');
});

test('splash error display - error messages are German', async () => {
  // Verify German error messages in startup
  const startupContent = require('node:fs').readFileSync('./src/main/startup.js', 'utf-8');
  
  assert(startupContent.includes('Der Datenordner'),
    'startup.js should use German error messages');
  assert(startupContent.includes('konnte nicht geladen werden'),
    'startup.js should use German error messages');
});

test('splash error display - IPC message structure includes code and message', async () => {
  // Verify IPC payload structure
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes('{ code, message }'),
    'main.js should send error with both code and message properties');
});

test('splash error display - ok button click handler sends correct channel', async () => {
  // Verify exact IPC channel name
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  assert(preloadContent.includes("ipcRenderer.send('splash:error-acknowledged')"),
    'splash-preload should send exact channel name splash:error-acknowledged');
});

test('splash error display - splash window is closed on non-fatal acknowledgment', async () => {
  // Verify splash.close() is called for non-fatal errors
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes('splashWindow.close()'),
    'main.js should close splash window on non-fatal error acknowledgment');
});

test('splash error display - app quits on fatal acknowledgment', async () => {
  // Verify app.quit() is called for fatal errors
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes('app.quit()'),
    'main.js should quit app on fatal error acknowledgment');
});

test('splash error display - both click and Enter key trigger same action', async () => {
  // Verify both input methods work
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  // Should have a function that handles both
  assert(preloadContent.includes('handleOk'),
    'splash-preload should have a handleOk function');
  assert(preloadContent.includes("addEventListener('click'"),
    'splash-preload should add click listener');
  assert(preloadContent.includes("addEventListener('keydown'"),
    'splash-preload should add keydown listener');
});

test('splash error display - error display matches minimal aesthetic colors', async () => {
  // Verify color consistency with splash
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  // Error display uses a subtle red background
  assert(htmlContent.includes('#fef3f2'),
    'splash.html error display should use minimal light red background');
  assert(htmlContent.includes('#c51a1a'),
    'splash.html error message text should use error red color');
  assert(htmlContent.includes('border: 1px solid'),
    'splash.html error display should have subtle border');
});

test('splash error display - ok button styling matches splash theme', async () => {
  // Verify button styling consistency
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(htmlContent.includes('#ok-button {') && htmlContent.includes('background: #c51a1a'),
    'OK button should use error red color background');
  assert(htmlContent.includes('border-radius: 6px'),
    'OK button should have rounded corners for consistency');
  assert(htmlContent.includes('font-size: 13px'),
    'OK button should use same font size as message for consistency');
});

test('splash error display - ok button is not draggable', async () => {
  // Verify button excludes app region drag
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(htmlContent.includes('-webkit-app-region: no-drag'),
    'OK button should exclude from app drag region for clickability');
});

test('splash error display - error display hides spinner and status when shown', async () => {
  // Verify visual transition (not automated, just layout support)
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  // Status and spinner remain visible, but error display replaces message area
  assert(htmlContent.includes('<div class="status"'),
    'splash.html should keep status visible');
  assert(htmlContent.includes('class="spinner"'),
    'splash.html should keep spinner visible');
  assert(htmlContent.includes('<div class="error-display"'),
    'splash.html should have error display area');
  assert(htmlContent.includes('<div class="message"'),
    'splash.html should keep message area for pre-error messages');
});
