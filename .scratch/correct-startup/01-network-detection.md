# 01: Network Availability Detection

**What to build:** ClubManager can detect whether the device is online before attempting update checks. This is a standalone function that the startup orchestrator and update system can use to decide whether to attempt network operations.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## End-to-End Behavior

When ClubManager starts, it first checks if the device is online by attempting to reach a reliable network endpoint (DNS lookup or HEAD request with timeout). The result is a simple boolean: true if online, false if offline or unreachable. The function never throws; all failures are treated as "offline".

## Acceptance Criteria

- [ ] `checkNetworkAvailable()` function exists and returns `Promise<boolean>`
- [ ] Returns `true` when DNS lookup or HTTP HEAD to reliable endpoint succeeds
- [ ] Returns `false` when endpoint is unreachable
- [ ] Returns `false` on timeout (5-second timeout maximum)
- [ ] Does NOT throw or crash on network errors
- [ ] Endpoint used is reliable and doesn't require authentication (e.g., npmjs.org DNS)
- [ ] Test: online scenario → returns true
- [ ] Test: offline scenario → returns false
- [ ] Test: timeout scenario → returns false
- [ ] Test: unreachable endpoint → returns false (not an exception)

## Implementation Notes

- Location: `src/main/main.js` or new `src/main/network.js`
- Use Node.js built-in `dns.promises.lookup()` or `http.request()` with timeout
- 5-second timeout is sufficient for startup UX
- Function signature: `async function checkNetworkAvailable(): Promise<boolean>`
- Export for use by startup orchestrator and tests
