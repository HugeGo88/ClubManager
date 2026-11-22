## Problem Statement

ClubManager's current startup procedure does not follow a consistent sequential order. The main window and update check run in parallel (on Windows/macOS), creating uncertainty about startup state. The splash screen can close before all critical operations complete, leaving the app in an ambiguous state if network or update operations fail.

Users expect a clear, predictable startup sequence:
1. Open splash
2. Check network
3. Check for updates (and install if available)
4. Load data folder
5. Load main window
6. Only then show the main window

The current implementation does not enforce this sequence, and error handling for missing data folders is not user-friendly. If a data folder becomes unavailable on startup, the app crashes instead of proceeding in a limited mode.

## Solution

Restructure the startup sequence into a strictly linear, testable pipeline:

**Startup Steps (Sequential)**
1. Open splash screen (minimal: spinner + "Starting up…")
2. Check network connectivity
3. Check for updates (only if online)
4. Auto-install updates (if available, silently, no user choice)
5. Load registered data folder
6. Load main window (silently, hidden)
7. Renderer signals ready (`app:startup-complete`)
8. Show main window + hide splash

Each step waits for the previous one. Fatal errors (update install fails) close the app. Non-fatal errors (folder unavailable) allow the app to proceed in read-only mode.

The splash screen only closes after **all startup steps complete AND the renderer signals ready**.

## Implementation Summary

### Main Seam: `startupSequence()` Orchestrator

A new function coordinates the entire startup pipeline:
- Checks network availability first
- Runs update check only if online
- Calls update install if available (fatal on failure)
- Loads data folder (non-fatal on failure)
- Returns startup result or throws for fatal errors

### Sub-Steps (Extracted Functions)

1. `checkNetworkAvailable()` → Promise<boolean>
2. `performUpdateCheck(isOnline)` → Promise<{available, version?}>
3. `performUpdateInstall()` → Promise<void> (throws on failure)
4. `loadDataFolder()` → Promise<{folder?, error?}>

### Error Handling

**Fatal Errors** (close app):
- Update installation fails

**Non-Fatal Errors** (proceed in read-only mode):
- Network offline
- Update check fails
- Data folder missing/unavailable

**Splash Screen Behavior**:
- Minimal messages during normal flow
- Error messages on failures (user clicks OK)
- Hides only after all steps complete + renderer signals ready

### Read-Only Mode

If data folder is unavailable on startup:
- Main window loads and shows
- Settings and folder picker remain available
- Data views (meetings, letters) are disabled
- User can select a new folder or restart

## Acceptance Criteria

- [ ] Startup sequence is strictly sequential on all platforms (Windows, macOS, Linux)
- [ ] Update check runs only if device is online
- [ ] Update install is automatic and silently fails over to folder load on network errors
- [ ] Data folder missing does not close the app; proceeds in read-only mode
- [ ] Splash screen shows only "Starting up…" with spinner during normal flow
- [ ] Splash error messages are human-readable and show what failed
- [ ] User must click OK on error messages before proceeding
- [ ] Splash closes only after all startup steps complete AND renderer signals ready
- [ ] Main window does not render until all startup steps complete
- [ ] Settings and folder picker are accessible in read-only mode
- [ ] Meeting/letter views are disabled in read-only mode
- [ ] startupSequence() function is testable with mocked sub-steps
- [ ] Network check, update check, update install, and folder load are tested independently
- [ ] Fatal errors close app; non-fatal errors proceed with error message
- [ ] Multiple platform behavior is identical (no special Linux parallelism)
- [ ] After auto-install restart, full sequence runs again from scratch

## Testing Strategy

### Good Tests

Tests verify external behavior and error handling, not implementation details. Mocks network, update, and folder availability. Verifies IPC messages in order.

### Modules to Test

1. `startupSequence()` orchestrator - all step combinations
2. `checkNetworkAvailable()` - online, offline, timeout
3. `performUpdateCheck()` - available, unavailable, fails
4. `performUpdateInstall()` - success, failure, splash messages
5. `loadDataFolder()` - success, failure, non-fatal handling
6. Splash IPC interface - message order, error display

### Prior Art

- Existing `test/updates.test.js` mocks EventEmitter and dialog; reuse this pattern
- Existing folder loading tests; enhance for read-only mode
- Existing splash IPC tests; extend for error messages

## Out of Scope

- Renderer-side read-only mode UI implementation
- Online calendar config updates
- Legacy document customization migration
- Multiple data folder registration
- Network detection improvements beyond DNS/HTTP check
- Telemetry or startup timing analytics
- Splash screen animation
- User-initiated retry after error

## Notes

- Timing: 10-20 seconds normal, 20-80 seconds with update download
- Platform Consistency: All platforms now follow identical sequential flow
- Restart After Update: `quitAndInstall()` closes, installer applies update, app relaunches and runs full sequence
- Multiple Updates: Electron updater may apply intermediate patches; install latest version
- Splash Persistence: Remains open and unmaximized (~420x240px) for entire startup
