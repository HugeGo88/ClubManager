# 05: Splash Error Display & User Acknowledgment

**What to build:** Errors during startup are displayed clearly on the splash screen, and users must click OK before the app continues or closes.

**Blocked by:** 04-orchestrator

**Status:** ready-for-agent

## End-to-End Behavior

When a fatal error occurs during startup (e.g., update install fails), or a non-fatal error occurs (e.g., folder missing), an error message appears on the splash screen with an OK button. 

The user clicks OK. If the error was fatal, the app closes. If the error was non-fatal, the app continues to load the main window in read-only mode.

Error messages are human-readable German text explaining what went wrong (e.g., "Die Aktualisierung konnte nicht installiert werden: Speicherplatz voll").

## Acceptance Criteria

- [ ] `splash.html` has an error display area (initially hidden)
- [ ] Error display area shows error message text (supports 1-3 lines)
- [ ] OK button is added to splash (initially hidden)
- [ ] `splash-preload.js` receives `splash:error-message` IPC from main process
- [ ] Preload shows error area and OK button when error message received
- [ ] User click on OK button sends `splash:error-acknowledged` IPC back to main
- [ ] Main process handler for `splash:error-acknowledged` is defined
- [ ] Fatal error path: show error on splash → user clicks OK → `app.quit()`
- [ ] Non-fatal error path: show error on splash → user clicks OK → continue startup
- [ ] Error messages are styled to match minimal splash aesthetic
- [ ] OK button is keyboard-accessible (Enter key triggers it)
- [ ] Error area is cleared if startup recovers (e.g., folder selected)
- [ ] Splash error IPC messages are tested in existing pattern

## Implementation Notes

- Location: `src/main/splash.html`, `src/main/splash-preload.js`, `src/main/main.js`
- Error display area: `<div id="error-message"></div>` with text node
- OK button: `<button id="error-ok">OK</button>`
- Preload IPC handler: `ipcRenderer.on('splash:error-message', (message) => { ... })`
- Main process handler: `ipcMain.on('splash:error-acknowledged', () => { ... })`
- Styling: use existing splash CSS (gray text, same font size, centered)
- Error messages passed as plain text, not HTML (no sanitization needed but keep safe)
- For fatal errors, main process calls `app.quit()` after user ack
- For non-fatal errors, main process resumes startup after user ack
- Existing splash progress messages (update-message) continue to work for non-error cases
