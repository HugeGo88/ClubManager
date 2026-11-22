# ClubManager Startup Procedure – Design Tree

## Sequential Flow (Strictly Linear — No Parallelism)

```
App Launches (main.js whenReady)
  ↓
1. OPEN SPLASH SCREEN
  (minimal: spinner + "Starting up…")
  ↓
2. CHECK NETWORK CONNECTION
  ├─→ Offline → proceed to step 3 (skip update)
  └─→ Online → proceed to step 3 (allow update check)
  ↓
3. CHECK FOR UPDATES (if online from step 2)
  ├─→ No update available → proceed to step 4
  ├─→ Update available → proceed to step 4a (AUTO-INSTALL)
  └─→ Check fails (network error) → proceed to step 4 (skip install)
  ↓
4a. AUTO-INSTALL UPDATE (if available from step 3)
  ├─→ Success → RESTART APP via quitAndInstall()
  │            (full startup sequence runs again)
  └─→ Fails → SHOW ERROR ON SPLASH
             (user clicks OK to ACK)
             → CLOSE APP
  ↓
4. LOAD DATA FOLDER (skipped in 4a restart path)
  ├─→ Success → Continue to step 5
  └─→ Fails → SHOW ERROR ON SPLASH (non-fatal)
             (user clicks OK to ACK)
             → Continue to step 5
  ↓
5. LOAD MAIN WINDOW
  (silently, NOT shown to user yet)
  ↓
6. RENDERER SIGNALS: app:startup-complete
  ↓
7. SHOW MAIN WINDOW + HIDE SPLASH
  (splash only closes AFTER both conditions met:
   - all startup checks complete (steps 1-5)
   - renderer signals startup-complete (step 6))
  ├─→ If folder is available → Full mode
  └─→ If folder unavailable → Read-only mode
                             (user can access settings/folder picker)
  ↓
USER INTERACTION BEGINS
```

## Decision Summary

| Phase | Decision | Rationale |
|-------|----------|-----------|
| **Window Loading** | Load silently in background, NOT shown until startup complete | Strict sequential guarantee; no rendering before all checks pass |
| **Update Auto-Install** | Always auto-install silently, no user choice | Automatic critical security updates |
| **Network Offline** | Skip update check entirely, proceed to folder load | No network = no update possible; non-blocking |
| **Update Check Fails** | Skip (treat as network error), proceed to folder load | Non-fatal network hiccup |
| **Update Install Fails** | FATAL → close app immediately, show error on splash | Updates must succeed or fail decisively |
| **Folder Missing/Unavailable** | NON-FATAL → show error dialog, proceed with no active folder in read-only mode | App still launches; user can access settings/folder picker |
| **Folder Load Timeout** | No timeout; wait forever if needed | Data integrity > startup speed; user can force-close |
| **Splash Screen Messages** | Minimal: just spinner + "Starting up…" | Don't clutter the splash with per-step details |
| **Error Display on Splash** | Show what failed + human-readable reason | Give user actionable information before close |
| **After Auto-Update Restart** | Run full sequence normally: network → skip checks if offline → folder → show | Standard restart flow; use quitAndInstall() |
| **Multiple Updates Available** | Let Electron updater handle (may apply patches sequentially under hood) | Respects version dependencies/migrations |
| **Folder Changed During Startup** | Complete startup with current folder, then ask user to restart | Graceful degradation; don't abort mid-startup |
| **Read-Only Mode (no folder)** | Access settings/folder picker, cannot view/edit meetings/letters until folder chosen | Allows user recovery |
| **Multi-Platform Behavior** | Strictly sequential on all platforms (Windows, macOS, Linux) | Update check waits for completion before folder load starts |

## Failure Modes

### Fatal Errors (app closes after splash)
1. **Update install fails** → Show error on splash + "Update installation failed: [reason]" → User clicks OK → Close app

### Non-Fatal Errors (proceed to main window in read-only mode)
1. **Network offline at startup** → Skip update check silently, load folder normally
2. **Update check fails** (network error) → Skip install attempt silently, load folder normally
3. **Data folder missing/unavailable** → Show error on splash + "Data folder unavailable: [reason]" → User clicks OK → Hide splash → Show main window in read-only mode

### Post-Startup Errors (shown after main window loads)
1. **Legacy document customization conflicts** → warning dialog, explain which were not overwritten
2. **Folder name cache failed to save** → non-blocking, try again next time
3. **Folder moved/deleted after load** → show on first access attempt, ask to restart

## State Flags & Tracking

- **`startupReady`**: Promise that resolves when all startup checks (network, update, folder) are complete
- **`startupComplete`**: Boolean flag; set to true when renderer sends `app:startup-complete`
- **`startupError`**: String; non-fatal errors recorded during startup, shown in dialog after window loads
- **`downloadedUpdate`**: Boolean; track if an update was just installed (for post-restart detection)

## Network Detection Implementation

```js
// Pseudo-code
async function checkNetworkAvailable() {
  try {
    // DNS lookup or HEAD request to a reliable endpoint
    // e.g., GET https://registry.npmjs.org with 5s timeout
    // Return true if reachable
  } catch (error) {
    return false; // Offline or unreachable
  }
}
```

## Multi-Platform Considerations

- **All platforms (Windows, macOS, Linux)**: Strictly sequential—update check completes before folder load starts
- No parallelism anywhere in startup sequence
- Each step waits for the previous one to finish

---

**Status**: ✅ Design tree locked and ready for implementation specification.
