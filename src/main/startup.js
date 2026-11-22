const dns = require('node:dns/promises');

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

module.exports = { checkNetworkAvailable, checkNetworkAvailableWithDnsResolve };
