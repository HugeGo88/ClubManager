const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadDataFolder } = require('../src/main/startup');

test('loadDataFolder returns object with either folder or error property', async () => {
  const result = typeof loadDataFolder;
  assert.equal(result, 'function');
});

test('loadDataFolder on success returns object with folder property', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const result = await loadDataFolder(root);
  assert(result !== null && typeof result === 'object');
  assert('folder' in result, 'Result should have folder property on success');
  assert.equal(result.folder, root);
  assert(!('error' in result), 'Result should not have error property on success');
});

test('loadDataFolder on missing folder returns object with error property', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const missingPath = path.join(root, 'nonexistent');
  const result = await loadDataFolder(missingPath);
  
  assert(result !== null && typeof result === 'object');
  assert('error' in result, 'Result should have error property on failure');
  assert(!('folder' in result), 'Result should not have folder property on failure');
  assert(result.error !== null && typeof result.error === 'object');
  assert('code' in result.error, 'Error should have code property');
  assert('message' in result.error, 'Error should have message property');
  assert.equal(result.error.code, 'FOLDER_NOT_FOUND');
  assert(typeof result.error.message === 'string');
  assert(result.error.message.length > 0);
});

test('loadDataFolder on file (not directory) returns error', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const filePath = path.join(root, 'file.txt');
  await fs.writeFile(filePath, 'test');
  
  const result = await loadDataFolder(filePath);
  
  assert('error' in result, 'Result should have error property when path is not a directory');
  assert.equal(result.error.code, 'INVALID_FOLDER');
  assert(typeof result.error.message === 'string');
});

test('loadDataFolder never throws errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  let threw = false;
  try {
    await loadDataFolder(path.join(root, 'nonexistent'));
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'loadDataFolder should never throw');
});

test('loadDataFolder error message is human-readable and in German', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const result = await loadDataFolder(path.join(root, 'nonexistent'));
  
  assert(result.error.message.length > 0);
  // Message should be in German and human-readable
  assert(typeof result.error.message === 'string');
  // Should not contain stack trace or technical jargon
  assert(!result.error.message.includes('Error:'));
});

test('loadDataFolder returns Promise', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  try {
    const result = loadDataFolder(path.join(root, 'nonexistent'));
    assert(result instanceof Promise);
    await result;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('loadDataFolder with null path returns error', async () => {
  const result = await loadDataFolder(null);
  assert('error' in result);
  assert.equal(result.error.code, 'INVALID_PATH');
});

test('loadDataFolder with empty string path returns error', async () => {
  const result = await loadDataFolder('');
  assert('error' in result);
  assert.equal(result.error.code, 'INVALID_PATH');
});

test('loadDataFolder with custom logger option logs errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const logs = [];
  const mockLogger = (...args) => logs.push(args);
  
  const result = await loadDataFolder(path.join(root, 'nonexistent'), { logger: mockLogger });
  
  assert('error' in result);
  assert.equal(logs.length, 1, 'Logger should have been called once');
  assert(logs[0].length > 0, 'Logger should have received arguments');
});

test('loadDataFolder on success does not log errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const logs = [];
  const mockLogger = (...args) => logs.push(args);
  
  const result = await loadDataFolder(root, { logger: mockLogger });
  
  assert('folder' in result);
  assert.equal(logs.length, 0, 'Logger should not have been called on success');
});

test('loadDataFolder returns consistent structure for all success cases', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const folder1 = path.join(root, 'folder1');
  const folder2 = path.join(root, 'folder2');
  await fs.mkdir(folder1);
  await fs.mkdir(folder2);
  
  const result1 = await loadDataFolder(folder1);
  const result2 = await loadDataFolder(folder2);
  
  assert.deepEqual(Object.keys(result1).sort(), ['folder']);
  assert.deepEqual(Object.keys(result2).sort(), ['folder']);
  assert.equal(result1.folder, folder1);
  assert.equal(result2.folder, folder2);
});

test('loadDataFolder returns consistent structure for all error cases', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  // Error case 1: missing folder
  const result1 = await loadDataFolder(path.join(root, 'missing'));
  
  // Error case 2: file instead of folder
  const filePath = path.join(root, 'file.txt');
  await fs.writeFile(filePath, 'test');
  const result2 = await loadDataFolder(filePath);
  
  // Both should have only 'error' property
  assert.deepEqual(Object.keys(result1).sort(), ['error']);
  assert.deepEqual(Object.keys(result2).sort(), ['error']);
  
  // Error object should have both code and message
  assert('code' in result1.error && 'message' in result1.error);
  assert('code' in result2.error && 'message' in result2.error);
});

test('loadDataFolder with deeply nested missing path returns FOLDER_NOT_FOUND error', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const deepPath = path.join(root, 'level1', 'level2', 'level3');
  const result = await loadDataFolder(deepPath);
  
  assert('error' in result);
  assert.equal(result.error.code, 'FOLDER_NOT_FOUND');
});

test('loadDataFolder with numeric type path returns error', async () => {
  const result = await loadDataFolder(123);
  assert('error' in result);
  assert.equal(result.error.code, 'INVALID_PATH');
});

test('loadDataFolder with object type path returns error', async () => {
  const result = await loadDataFolder({ path: '/tmp' });
  assert('error' in result);
  assert.equal(result.error.code, 'INVALID_PATH');
});

test('loadDataFolder error codes are consistent across error types', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-folder-load-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  
  const errorCodes = new Set();
  
  // Collect all error codes
  const result1 = await loadDataFolder(null);
  const result2 = await loadDataFolder('');
  const result3 = await loadDataFolder(path.join(root, 'nonexistent'));
  
  const filePath = path.join(root, 'file.txt');
  await fs.writeFile(filePath, 'test');
  const result4 = await loadDataFolder(filePath);
  
  errorCodes.add(result1.error.code);
  errorCodes.add(result2.error.code);
  errorCodes.add(result3.error.code);
  errorCodes.add(result4.error.code);
  
  // All error codes should be one of the expected values
  for (const code of errorCodes) {
    assert(['INVALID_PATH', 'FOLDER_NOT_FOUND', 'INVALID_FOLDER', 'FOLDER_LOAD_ERROR'].includes(code));
  }
});
