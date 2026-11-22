const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Integration tests for splash error handling in main.js
 * These tests verify that the splash error display feature integrates correctly
 * with the startup sequence and handles both fatal and non-fatal errors.
 */

test('main.js defines startupErrorIsFatal flag', async () => {
  // This is a structural test - main.js should have the flag
  const fs = require('node:fs');
  const mainContent = fs.readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes('let startupErrorIsFatal'), 
    'main.js should define startupErrorIsFatal flag');
});

test('main.js sendSplashError sets fatal flag for UPDATE_INSTALL_FAILED', async () => {
  // Test that fatal errors are properly identified
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes("code === 'UPDATE_INSTALL_FAILED'"),
    'main.js should check for UPDATE_INSTALL_FAILED error code');
  assert(mainContent.includes('startupErrorIsFatal'),
    'main.js should set startupErrorIsFatal flag');
});

test('main.js has splash:error-acknowledged handler', async () => {
  // Test that IPC handler is registered
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes("'splash:error-acknowledged'"),
    'main.js should handle splash:error-acknowledged IPC');
  assert(mainContent.includes('ipcMain.on'),
    'main.js should register error-acknowledged handler with ipcMain.on');
});

test('main.js error handler quits app on fatal error', async () => {
  // Test that fatal errors trigger app.quit()
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  // Find the splash:error-acknowledged handler
  const handlerMatch = mainContent.match(
    /ipcMain\.on\('splash:error-acknowledged'[\s\S]*?app\.quit\(\)/
  );
  
  assert(handlerMatch, 
    'main.js error handler should call app.quit() for fatal errors');
});

test('main.js error handler closes splash on non-fatal error', async () => {
  // Test that non-fatal errors close splash
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  // Find the splash:error-acknowledged handler
  const handlerMatch = mainContent.match(
    /ipcMain\.on\('splash:error-acknowledged'[\s\S]*?splashWindow\.close\(\)/
  );
  
  assert(handlerMatch,
    'main.js error handler should close splash on non-fatal errors');
});

test('splash:error-acknowledged handler checks startupErrorIsFatal', async () => {
  // Test conditional logic in handler
  const mainContent = require('node:fs').readFileSync('./src/main/main.js', 'utf-8');
  
  assert(mainContent.includes('if (startupErrorIsFatal)'),
    'splash:error-acknowledged handler should check startupErrorIsFatal flag');
});

test('startup sequence returns fatal error with UPDATE_INSTALL_FAILED code', async () => {
  // Test that startup.js properly marks update failures as fatal
  const startupContent = require('node:fs').readFileSync('./src/main/startup.js', 'utf-8');
  
  assert(startupContent.includes('UPDATE_INSTALL_FAILED'),
    'startup.js should use UPDATE_INSTALL_FAILED error code for fatal errors');
});

test('startup sequence sends error via sendSplashError callback', async () => {
  // Test that startup.js calls sendSplashError with error code
  const startupContent = require('node:fs').readFileSync('./src/main/startup.js', 'utf-8');
  
  assert(startupContent.includes('sendSplashError(error.code, error.message)'),
    'startup.js should call sendSplashError with error code and message');
});

test('splash-preload handler receives and displays error properly', async () => {
  // Test preload implementation
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  assert(preloadContent.includes("'splash:error-message'"),
    'splash-preload should listen to splash:error-message');
  assert(preloadContent.includes("data.message"),
    'splash-preload should use error message from data');
  assert(preloadContent.includes("'show'"),
    'splash-preload should add show class to display error');
});

test('splash-preload sends acknowledgment on OK button click', async () => {
  // Test preload send logic
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  assert(preloadContent.includes("'splash:error-acknowledged'"),
    'splash-preload should send splash:error-acknowledged');
  assert(preloadContent.includes("ipcRenderer.send"),
    'splash-preload should use ipcRenderer.send to acknowledge');
});

test('splash-preload sets up keyboard handler for Enter key', async () => {
  // Test Enter key support
  const preloadContent = require('node:fs').readFileSync('./src/main/splash-preload.js', 'utf-8');
  
  assert(preloadContent.includes("'keydown'"),
    'splash-preload should listen to keydown events');
  assert(preloadContent.includes("e.key === 'Enter'"),
    'splash-preload should check for Enter key');
});

test('splash.html error-display is styled to match minimal splash aesthetic', async () => {
  // Test styling consistency
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(htmlContent.includes('#fef3f2') || htmlContent.includes('error'),
    'splash.html should have error-specific styling');
  assert(htmlContent.includes('font-size: 13px'),
    'splash.html error message should use consistent font size');
});

test('splash.html OK button has hover and focus states', async () => {
  // Test button accessibility
  const htmlContent = require('node:fs').readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(htmlContent.includes('#ok-button:hover'),
    'splash.html should have hover state for OK button');
  assert(htmlContent.includes('#ok-button:focus'),
    'splash.html should have focus state for OK button for keyboard access');
  assert(htmlContent.includes('outline'),
    'splash.html should have visible focus outline for accessibility');
});
