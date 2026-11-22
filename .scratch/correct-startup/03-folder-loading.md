# 03: Data Folder Loading with Non-Fatal Errors

**What to build:** Data folder loading can fail gracefully without crashing the app. Instead of throwing, it returns an error object that the orchestrator can handle.

**Blocked by:** None (can start immediately, independent)

**Status:** ready-for-agent

## End-to-End Behavior

When ClubManager loads the registered data folder on startup, it no longer crashes if the folder is missing or inaccessible. Instead, it returns either `{folder: path}` on success or `{error: message}` on failure. The calling code can decide to proceed in read-only mode.

This enables the app to start and display settings even if the user's data folder has been moved or deleted, allowing them to configure a new folder.

## Acceptance Criteria

- [ ] `loadDataFolder()` function exists and returns `Promise<{folder?: string, error?: string}>`
- [ ] Returns `{folder: path}` when folder exists and loads successfully
- [ ] Returns `{error: message}` when folder is missing or inaccessible
- [ ] Returns `{error: message}` when folder initialization fails (readable but not writable, etc.)
- [ ] Does NOT throw or crash when folder missing
- [ ] Does NOT set a timeout; waits indefinitely if folder is slow to respond
- [ ] Existing folder initialization logic preserved (storage, meetings list, letters list)
- [ ] Error messages are descriptive German text suitable for user display
- [ ] Test: folder exists → returns {folder}
- [ ] Test: folder missing → returns {error}
- [ ] Test: folder not readable → returns {error}
- [ ] Test: existing folder loading tests still pass

## Implementation Notes

- Location: `src/main/main.js`
- Refactor existing `loadFolder()` function to not throw
- Preserve all initialization steps: storage.initializeFolder(), storage.listMeetings(), letters.listLetters()
- Existing folder availability check (`checkFolderAvailability()`) returns false; wrap in try/catch
- Error object replaces thrown exceptions
- Function signature: `async function loadDataFolder(): Promise<{folder?: string, error?: string}>`
- Export for use by startup orchestrator
