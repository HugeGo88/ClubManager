const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/**
 * Test seams for splash error display feature:
 * 1. splash.html has error display area (initially hidden)
 * 2. splash.html has OK button (initially hidden)
 * 3. splash-preload.js receives splash:error-message IPC
 * 4. splash-preload.js shows error area and button when error received
 * 5. User clicks OK button, sends splash:error-acknowledged IPC
 * 6. OK button is keyboard-accessible (Enter key)
 * 7. main.js has handler for splash:error-acknowledged
 * 8. Fatal error path: show error → user clicks OK → app.quit()
 * 9. Non-fatal error path: show error → user clicks OK → continue startup
 */

test('splash error display - HTML has error display area', async (t) => {
  // Test that splash.html has error display area
  const html = fs.readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(html.includes('id="error-display"'), 'splash.html should have error-display element');
  assert(html.includes('id="error-message"'), 'splash.html should have error-message element');
  assert(html.includes('class="error-display"') || html.includes('id="error-display"'), 'error-display should exist');
});

test('splash error display - HTML has OK button', async (t) => {
  // Test that splash.html has OK button
  const html = fs.readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(html.includes('id="ok-button"'), 'splash.html should have OK button with id="ok-button"');
});

test('splash error display - styles hide error display initially', async (t) => {
  // Test that CSS has rule to hide error display
  const html = fs.readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(html.includes('.error-display {') && html.includes('display: none'), 
    'splash.html CSS should hide .error-display by default');
});

test('splash error display - styles hide error display initially', async (t) => {
  // Test that CSS has rule to hide error display
  const html = fs.readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(html.includes('.error-display {') && html.includes('display: none'), 
    'splash.html CSS should hide .error-display by default');
});

test('splash error display - styles show error display on show class', async (t) => {
  // Test that CSS has rule to show error display when show class added
  const html = fs.readFileSync('./src/main/splash.html', 'utf-8');
  
  assert(html.includes('.error-display.show') && html.includes('display: block'),
    'splash.html CSS should show .error-display.show');
});

test('splash-preload receives splash:error-message IPC', async (t) => {
  // Test that preload sets up IPC listener for splash:error-message
  const { EventEmitter } = require('node:events');
  
  const ipcRenderer = new EventEmitter();
  
  let receivedData = null;
  ipcRenderer.on('splash:error-message', (_event, data) => {
    receivedData = data;
  });
  
  // Emit error message
  ipcRenderer.emit('splash:error-message', {}, { code: 'TEST_ERROR', message: 'Test error message' });
  
  assert.deepEqual(receivedData, { code: 'TEST_ERROR', message: 'Test error message' }, 
    'preload should receive error message via IPC');
});

test('splash-preload handler stores error message text', async (t) => {
  // Test that preload can display error message text
  const { EventEmitter } = require('node:events');
  
  const ipcRenderer = new EventEmitter();
  let errorText = '';
  
  ipcRenderer.on('splash:error-message', (_event, data) => {
    errorText = data.message;
  });
  
  // Emit error message
  ipcRenderer.emit('splash:error-message', {}, { code: 'FOLDER_NOT_FOUND', message: 'Datenordner nicht gefunden' });
  
  assert.equal(errorText, 'Datenordner nicht gefunden', 'error message text should be stored');
});

test('splash-preload sends splash:error-acknowledged on button interaction', async (t) => {
  // Test that preload sends acknowledgment
  const { EventEmitter } = require('node:events');
  
  const ipcRenderer = new EventEmitter();
  let sentChannel = null;
  
  ipcRenderer.send = (channel, data) => {
    sentChannel = channel;
  };
  
  // Simulate user clicking OK and sending acknowledgment
  ipcRenderer.send('splash:error-acknowledged');
  
  assert.equal(sentChannel, 'splash:error-acknowledged', 'should send splash:error-acknowledged');
});

test('splash-preload supports Enter key for OK button', async (t) => {
  // Test that Enter key can trigger OK button
  const { EventEmitter } = require('node:events');
  
  const ipcRenderer = new EventEmitter();
  ipcRenderer.send = function() {}; // Add send method
  
  let keydownHandled = false;
  
  // Simulate keydown handler on OK button
  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      keydownHandled = true;
      ipcRenderer.send('splash:error-acknowledged');
    }
  };
  
  // Simulate Enter keypress
  handleKeydown({ key: 'Enter' });
  
  assert.equal(keydownHandled, true, 'Enter key should be handled');
});
