---
status: accepted
---

# Folder-local module selection

Each data folder will own one explicit module selection, stored with that
folder and shared by everyone opening it. This replaces app-wide module
visibility with portable, folder-specific settings rather than inferring
modules from records or adding personal overrides. The design is agreed;
the first implementation slice provides folder-local persistence, activation,
navigation and failure recovery. Draft protection for module-setting changes
(#16) is implemented. Settings-entry refresh and stale-write conflict handling
(#17) remain unimplemented.

## Considered options

- **Folder-local selection (chosen):** the same folder opens with the same
  modules on different computers.
- **Computer-local selection per folder:** avoids shared edits but does not
  travel with the data.
- **Automatic detection:** cannot express a deliberate choice to hide a
  module whose records must be retained.

## Agreed behavior

- The existing module toggles edit only the active data folder and identify
  it by its display name. No active, usable folder means no editable module
  controls.
- The selection covers Meetings, Members, Invoices, and Letters. This does
  not implement the Members or Invoices placeholders.
- Disabling a module hides its interface without deleting records. It is
  not an authorization boundary. All modules may be disabled; Settings,
  the manual, release history, and folder switching remain available.
- A recognizable existing ClubManager folder without module settings
  inherits the legacy app-wide selection once. Later edits are independent
  for each folder.
- A folder with no existing ClubManager structure or records starts with
  Meetings only. An empty folder already initialized by ClubManager counts
  as existing; directory age and unrelated files do not determine this.
- Existing-folder detection happens before initializing module directories.
- Folder switching loads destination data and module selection together.
  Keep the current module if enabled there; otherwise select the first
  enabled module in navigation order, or Settings when none is enabled.
- Before a folder switch or hiding an edited module, offer Save / Discard /
  Cancel when there are unsaved edits. Cancellation or a failed save retains
  the editing state and prevents the transition.
- Reload module settings when opening a folder, switching to it, or entering
  Settings. No live file watching is planned.
- Reject saves that conflict with an externally changed selection and
  require a reload instead of silently overwriting the external change.
  Cancelling a refresh must not overwrite those newer settings.
- Missing module settings are initialized using the rules above. Invalid
  settings are not silently replaced. Read, validation, initialization,
  and save failures show an explicit error and retain the last valid state;
  a failed folder switch retains the previous active folder.
- At startup, if the saved active folder has unusable module settings,
  keep folder-backed modules inactive, report the error, and retain access
  to Settings and folder selection.

## Consequences

Module selection becomes shared folder configuration, not a per-person
preference. Concurrent edits require conflict handling, and portable
configuration introduces validation and write failures into folder activation.
The legacy app-wide selection is only a migration source, not a second
configuration layer.

The precise file schema and conflict-detection mechanism remain implementation
details. Existing folder display-name metadata must remain compatible;
renaming a folder must not erase its module selection.

Implementation must update the architecture's current-behavior description
and the German manual together, with focused tests for migration, switching,
unsaved edits, failures, and external conflicts.
