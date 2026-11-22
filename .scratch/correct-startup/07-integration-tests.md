# 07: Integration Tests & Acceptance Verification

**What to build:** Comprehensive integration tests that verify all 15 acceptance criteria from the specification are met. All startup scenarios (online/offline, update available/not, folder exists/missing) are tested end-to-end.

**Blocked by:** 06-readonly-mode

**Status:** ready-for-agent

## End-to-End Behavior

A new test file (`test/startup-sequence.test.js`) contains integration tests covering:
- All combinations of network status, update availability, folder availability
- Splash message ordering (verify each step sends expected messages in order)
- Fatal error handling (update install fails → app closes)
- Non-fatal error handling (folder missing → read-only mode)
- Main window rendering gating (doesn't render until all checks complete)
- Platform behavior consistency (identical across Windows, macOS, Linux)

Each test verifies the user-visible behavior, not implementation details. Tests use mocked dependencies (network check, update check, folder load) following the pattern established in existing tests.

## Acceptance Criteria

- [ ] Test file `test/startup-sequence.test.js` exists
- [ ] Test: online, no update, folder exists → normal startup completes
- [ ] Test: offline → update check skipped, folder loads, startup completes
- [ ] Test: online, update available, install succeeds → restart triggered
- [ ] Test: online, update available, install fails → error shown on splash, app closes
- [ ] Test: online, update check fails (network error) → skipped, startup continues
- [ ] Test: folder missing → error shown on splash, main window loads in read-only
- [ ] Test: folder missing, user clicks OK → main window shows with folder=null
- [ ] Test: splash messages sent in correct order: (1) "Starting up", (2) updates if checking, (3) error if fails
- [ ] Test: splash closes only after all steps complete AND renderer signals ready
- [ ] Test: main window does NOT load/render until all startup checks complete
- [ ] Test: network check runs first (before update check)
- [ ] Test: update check only runs if online
- [ ] Test: update install only runs if available
- [ ] Test: folder load runs regardless of update outcome
- [ ] Test: startup sequence identical on Windows, macOS, Linux
- [ ] Test: post-restart (after update install) runs full sequence again
- [ ] Test: multiple updates available → latest version installed directly
- [ ] All 15 acceptance criteria from main spec are verified by at least one test
- [ ] Existing tests in `test/updates.test.js` still pass
- [ ] Existing tests for folder loading still pass
- [ ] No test failures or flakes

## Implementation Notes

- Location: `test/startup-sequence.test.js` (new file)
- Use Node.js built-in `test` module (consistent with existing tests)
- Use `EventEmitter` for mocked updater (following pattern in test/updates.test.js)
- Mock `checkNetworkAvailable()` to return true/false per test
- Mock `performUpdateCheck()` to return available or not
- Mock `performUpdateInstall()` to succeed or throw per test
- Mock `loadDataFolder()` to return folder or error per test
- Verify IPC messages sent to splash via spy/mock of `webContents.send()`
- Verify app quit/restart via spy of `app.quit()` and `quitAndInstall()`
- Tests should be readable and document the expected startup behavior for future maintainers
- Each test should be named descriptively: "startup when online, no update, folder exists"
- Group tests by scenario (happy path, error handling, platform consistency)
