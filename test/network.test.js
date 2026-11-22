const test = require('node:test');
const assert = require('node:assert/strict');
const { checkNetworkAvailable } = require('../src/main/startup');

test('checkNetworkAvailable returns boolean', async () => {
  const result = await checkNetworkAvailable();
  assert.equal(typeof result, 'boolean');
});

test('checkNetworkAvailable returns true when network is available', async () => {
  const result = await checkNetworkAvailable();
  // On a network-connected machine, this should be true
  assert.equal(result, true);
});

test('checkNetworkAvailable never throws - all errors return false', async () => {
  let threw = false;
  try {
    await checkNetworkAvailable();
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});

test('checkNetworkAvailable returns Promise', async () => {
  const result = checkNetworkAvailable();
  assert(result instanceof Promise);
  await result;
});

test('checkNetworkAvailable with custom DNS resolver: success returns true', async () => {
  const { checkNetworkAvailableWithDnsResolve } = require('../src/main/startup');
  const mockResolve = async () => {};
  const result = await checkNetworkAvailableWithDnsResolve(mockResolve);
  assert.equal(result, true);
});

test('checkNetworkAvailableWithDnsResolve with DNS error returns false', async () => {
  const { checkNetworkAvailableWithDnsResolve } = require('../src/main/startup');
  const mockResolve = async () => {
    throw new Error('DNS lookup failed');
  };
  const result = await checkNetworkAvailableWithDnsResolve(mockResolve);
  assert.equal(result, false);
});

test('checkNetworkAvailableWithDnsResolve with timeout returns false', async () => {
  const { checkNetworkAvailableWithDnsResolve } = require('../src/main/startup');
  const mockResolve = async () => {
    const error = new Error('getaddrinfo ETIMEDOUT');
    error.code = 'ETIMEDOUT';
    throw error;
  };
  const result = await checkNetworkAvailableWithDnsResolve(mockResolve);
  assert.equal(result, false);
});

test('checkNetworkAvailableWithDnsResolve with unreachable host returns false', async () => {
  const { checkNetworkAvailableWithDnsResolve } = require('../src/main/startup');
  const mockResolve = async () => {
    const error = new Error('getaddrinfo ENOTFOUND');
    error.code = 'ENOTFOUND';
    throw error;
  };
  const result = await checkNetworkAvailableWithDnsResolve(mockResolve);
  assert.equal(result, false);
});
