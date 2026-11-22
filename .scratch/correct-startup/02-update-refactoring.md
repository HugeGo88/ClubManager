# 02: Update Check & Install Refactoring

**What to build:** Update checking and installation are separated into two independent, testable functions. Update check runs only if online; installation is fatal if it fails.

**Blocked by:** 01-network-detection

**Status:** ready-for-agent

## End-to-End Behavior

The existing `startUpdates()` function is refactored into two smaller, independent functions:
- `performUpdateCheck(isOnline: boolean)` - Checks for available updates, only if online
- `performUpdateInstall()` - Downloads and installs available updates, throws on failure

Each function is testable independently. The existing behavior is preserved: updates are auto-downloaded and auto-installed on startup, with splash screen messages sent via IPC.

## Acceptance Criteria

- [ ] `performUpdateCheck(isOnline)` returns `{available: false}` when isOnline is false
- [ ] `performUpdateCheck(isOnline)` calls `autoUpdater.checkForUpdates()` when isOnline is true
- [ ] `performUpdateCheck()` returns `{available: true, version: string}` when update found
- [ ] `performUpdateCheck()` returns `{available: false}` when no update available
- [ ] `performUpdateCheck()` returns `{available: false}` on network error (doesn't throw)
- [ ] `performUpdateInstall()` subscribes to `update-downloaded` event
- [ ] `performUpdateInstall()` calls `autoUpdater.quitAndInstall(false, true)` on success
- [ ] `performUpdateInstall()` throws descriptive error if installation fails (fatal)
- [ ] Splash messages sent during download: "Neue Version X.Y.Z wird heruntergeladen…"
- [ ] Splash messages sent during install: "Version X.Y.Z wird installiert…"
- [ ] Existing tests in `test/updates.test.js` still pass
- [ ] Both functions are exported for use by startup orchestrator

## Implementation Notes

- Location: `src/main/updates.js`
- Extract from existing `startUpdates()` function
- Keep existing auto-download and auto-install behavior on Linux
- Both functions accept injected dependencies (updater, dialog, getWindow, getSplashWindow) for testing
- Function signatures:
  - `async function performUpdateCheck(isOnline: boolean): Promise<{available: boolean, version?: string}>`
  - `async function performUpdateInstall(): Promise<void>` (throws on failure)
- Tests should use mocked EventEmitter as updater (following existing pattern in test/updates.test.js)
