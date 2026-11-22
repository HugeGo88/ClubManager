# 06: Renderer Read-Only Mode Detection

**What to build:** When the data folder is unavailable on startup, the renderer detects this and disables data operations (meetings, letters) while keeping settings and folder picker available.

**Blocked by:** 05-splash-errors

**Status:** ready-for-agent

## End-to-End Behavior

After startup completes and the main window shows, the renderer checks if an active data folder is available. If `moduleSettings.folder` is null (folder missing on startup), the renderer:
- Disables navigation to Meetings, Letters, and Calendar
- Disables all data operations (list, create, edit, delete, export)
- Displays an error message in settings explaining the folder is missing
- Keeps Settings, folder picker, manual, and changelog visible and functional
- Allows user to select a new folder

This allows the app to remain usable even when the configured data folder has been moved or deleted.

## Acceptance Criteria

- [ ] Renderer receives `moduleSettings.folder` as null when folder missing
- [ ] Meeting list view is disabled/hidden when folder is null
- [ ] Meeting detail/edit view is disabled when folder is null
- [ ] Meeting export is disabled when folder is null
- [ ] Letters list view is disabled/hidden when folder is null
- [ ] Letters detail/edit view is disabled when folder is null
- [ ] Letters export is disabled when folder is null
- [ ] Calendar view (if enabled) is disabled when folder is null
- [ ] Settings view is always enabled
- [ ] Folder picker in settings is always enabled
- [ ] Manual (Handbuch) view is always enabled
- [ ] Changelog (Versionsverlauf) view is always enabled
- [ ] Error message shown in settings: "Der gespeicherte Datenordner ist nicht verfügbar…"
- [ ] Selecting new folder in folder picker sends `folder:activate` IPC
- [ ] App restarts (or reopens) with new folder selected
- [ ] No console errors or crashes when folder is null
- [ ] No rendering of data UI elements (meetings list, etc.) when folder is null

## Implementation Notes

- Location: `src/renderer/` (various components and store)
- Check `moduleSettings.folder` in renderer initialization
- Conditional rendering/disabling based on folder availability
- Settings component should show error message via existing error handling
- Folder picker already exists in Settings; ensure it's always functional
- Navigation should skip/hide data module links when folder is null
- Existing code already has `requireFolder()` helper; use or enhance it
- Error message should be clear German text (use existing i18n if available)
- Test: load with folder=null → data views disabled
- Test: load with folder=null → settings enabled
- Test: select new folder → app restarts with new folder
