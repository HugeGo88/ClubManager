# 04: Startup Sequence Orchestrator

**What to build:** Implement the core startup orchestrator that coordinates all 7 steps in strict sequential order: network check → update check → update install → folder load → main window load, with error handling.

**Blocked by:** 01-network-detection, 02-update-refactoring, 03-folder-loading

**Status:** ready-for-agent

## End-to-End Behavior

The startup orchestrator (`startupSequence()`) is a new async function that runs all startup steps in order, ensuring each step completes before the next begins. 

Flow:
1. Check network availability
2. If online, check for updates
3. If update available, install it (throws fatal error if fails)
4. Load data folder (non-fatal error handling)
5. Load main window (silently, hidden from user)
6. Return result with folder path or error message

The splash screen is kept visible throughout this process via IPC messages. The main window is not shown to the user until after the renderer signals `app:startup-complete`.

## Acceptance Criteria

- [ ] `startupSequence()` function exists and coordinates all 7 steps
- [ ] Steps run in strict sequential order (network → update → folder → window)
- [ ] Network check runs first
- [ ] Update check only runs if network is online
- [ ] Update install only runs if update is available
- [ ] Update install failure throws fatal error (propagated to main process)
- [ ] Folder load runs regardless of update outcome
- [ ] Folder load failure recorded but does NOT throw (non-fatal)
- [ ] Main window loads silently after all checks complete
- [ ] Splash receives IPC message for each major step
- [ ] Splash messages are minimal: used only for fatal errors or progress
- [ ] Function returns `{success: true, folder?: string}` on success
- [ ] Function throws on fatal errors (update install fails)
- [ ] Function captures non-fatal errors (folder missing) in return value or separate state
- [ ] Startup sequence completes before main window is shown to user
- [ ] Platform behavior is identical (no Windows vs. Linux vs. macOS differences)
- [ ] Test: online, no update, folder exists → success
- [ ] Test: offline → skips update check, proceeds to folder
- [ ] Test: online, update fails → throws fatal error
- [ ] Test: folder missing → continues with error recorded
- [ ] All existing tests for update and folder loading still pass

## Implementation Notes

- Location: `src/main/main.js`
- Use promises/async-await for sequential flow
- Replace existing parallel behavior (`Promise.all([folderReady, updateReady])`)
- Call sub-step functions in order: `checkNetworkAvailable()`, `performUpdateCheck()`, `performUpdateInstall()`, `loadDataFolder()`
- Wrap in try-catch to distinguish fatal from non-fatal errors
- Send splash IPC messages via existing `splash.webContents.send()` channel
- Do NOT show main window; that happens after renderer signals ready (separate)
- Function signature: `async function startupSequence(): Promise<{success: boolean, folder?: string, error?: string}>`
- Exported for use by main process and integration tests
