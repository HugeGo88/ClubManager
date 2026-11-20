# Folder-local module selection

## Problem Statement

ClubManager can register and switch between multiple data folders, but module
visibility is currently app-wide. Users working with different clubs or contexts
cannot give each data folder its own module selection. Enabling or hiding a module
for one context changes the interface for every other context, and the selection
does not travel with the folder to another computer.

Users need a predictable, explicit module selection for each data folder without
losing saved records, unsaved edits, or access to recovery controls.

## Solution

Give each data folder one explicit, portable module selection. The existing module
toggles configure the active data folder and clearly identify it by its data folder
display name. Opening or switching to a folder restores its selection together
with its records.

Recognizable existing ClubManager folders without module settings inherit the
legacy app-wide selection once. Folders without existing ClubManager structure or
records start with Meetings only. Disabling modules hides their interface but
preserves their records. All modules may be disabled.

Protect unsaved edits, report configuration failures explicitly, and reject
conflicting saves rather than overwriting changes made elsewhere. This is the
agreed design recorded in ADR 0002, currently proposed and not implemented.

## User Stories

1. As a user working with multiple clubs, I want each data folder to have its own
   module selection, so that each club has an appropriate interface.
2. As a user, I want to explicitly choose enabled modules, so that files already
   present do not unexpectedly change my selection.
3. As a user, I want the selection stored with the data folder, so that it travels
   with copies, moves, and backups.
4. As a user opening the same folder on another computer, I want its saved
   selection restored, so that the interface remains consistent.
5. As a collaborator, I want everyone opening the same folder to share one
   selection, so that there are no hidden personal overrides.
6. As a user, I want the existing module toggles to edit only the active data
   folder, so that other folders remain unchanged.
7. As a user, I want the module controls to show the active data folder display
   name, so that I know which context I am changing.
8. As a user without a usable active data folder, I want module controls disabled,
   so that I cannot accidentally edit global or unrelated settings.
9. As an existing user, I want an existing ClubManager folder without module
   settings to inherit my legacy app-wide selection once, so that migration
   preserves my setup.
10. As an existing user registering another legacy folder later, I want that
    folder to use the legacy migration source rather than another folder's current
    selection, so that migration remains independent.
11. As a user reopening a configured folder, I want its saved selection preserved,
    so that initialization does not reset my choices.
12. As a user starting a new data folder, I want only Meetings enabled initially,
    so that the default remains familiar and minimal.
13. As a user selecting a directory containing unrelated files, I want it treated
    as a new data folder when no ClubManager structure or records exist, so that
    unrelated content does not affect defaults.
14. As a user selecting an empty but previously initialized ClubManager folder, I
    want it treated as existing, so that its established context receives the
    migration behavior.
15. As a user, I want to configure Meetings, Members, Invoices, and Letters through
    the existing controls, so that this feature preserves the available module
    choices.
16. As a user disabling a module, I want its navigation and views hidden, so that
    unused functionality does not clutter the interface.
17. As a user disabling a module, I want its saved records left untouched, so that
    hiding functionality never deletes my work.
18. As a user re-enabling a module, I want its saved records available again, so
    that I can resume using it.
19. As a user, I want to disable every module if needed, so that the folder can
    retain data without exposing business-module views.
20. As a user with every module disabled, I want Settings, the manual, release
    history, and folder switching to remain available, so that I can recover or
    change context.
21. As a user switching folders, I want the destination records and module
    selection activated together, so that the interface never combines two
    folders' contexts.
22. As a user switching folders, I want to stay in my current module when it is
    enabled in the destination, so that navigation remains predictable.
23. As a user switching to a folder where my current module is disabled, I want
    the first enabled module in navigation order selected, so that I land in an
    available view.
24. As a user switching to a folder with no enabled modules, I want Settings
    opened, so that I can configure that folder.
25. As a user with unsaved edits, I want Save / Discard / Cancel before switching
    folders or hiding the edited module, so that transitions do not silently lose
    work.
26. As a user choosing Save, I want saving to finish successfully before the
    transition, so that my changes remain in the correct folder.
27. As a user choosing Discard, I want the transition to proceed without persisting
    the draft, so that I can deliberately abandon it.
28. As a user choosing Cancel, I want the current editing state preserved, so that
    I can continue working without a partial transition.
29. As a user whose draft cannot be saved, I want an explicit error and the editing
    state retained, so that a failed save does not lose my work or change folders.
30. As a user opening a folder or entering Settings, I want its module selection
    refreshed from disk, so that externally saved choices become visible at
    predictable points.
31. As a user whose edited module is disabled by a refreshed selection, I want
    the same unsaved-edit protection, so that external changes cannot silently
    hide my draft.
32. As a user cancelling an external refresh, I want the newer settings on disk
    left untouched, so that preserving my editor does not overwrite another
    person's changes.
33. As a collaborator saving a selection based on stale settings, I want a conflict
    error and a required reload, so that unseen external changes are not silently
    overwritten.
34. As a user opening a folder with invalid or unreadable module settings, I want
    a clear error rather than silent defaults, so that configuration problems
    remain visible and recoverable.
35. As a user whose module settings cannot be initialized or saved, I want the
    last valid state retained, so that the interface does not claim an unsaved
    selection succeeded.
36. As a user whose destination folder cannot be activated, I want the previous
    active folder and its interface retained, so that a failed switch leaves a
    coherent context.
37. As a user starting the app with unusable module settings, I want folder-backed
    modules inactive but Settings and folder selection available, so that I can
    recover without operating under guessed settings.
38. As a user renaming a data folder, I want its module selection preserved, so
    that a display-name edit cannot erase configuration.
39. As a user switching folders, I want unrelated app-wide preferences such as
    sidebar width unchanged, so that this feature only changes module ownership.
40. As a German-speaking user, I want the manual and interface wording to explain
    folder-scoped module selection, so that the behavior is understandable without
    reading development documentation.

## Implementation Decisions

- Follow the glossary concepts Data folder, Active data folder, Registered data
  folder, Data folder display name, and Module selection, and respect ADR 0002.
  Module selection is shared folder configuration, not a per-person preference or
  an authorization boundary.
- Keep the existing module set: Meetings, Members, Invoices, and Letters. Members
  and Invoices remain placeholders; this issue does not implement their business
  functionality.
- Move authoritative module configuration from app-wide preferences into
  validated, versioned folder-local configuration. The precise filename and schema
  are implementation details, not a new product decision. Preserve compatibility
  with folder display-name metadata: renaming must not erase module settings, and
  updating module settings must not erase the display name.
- Reuse existing persistence, safe-write, validation, and error-reporting patterns.
  Validate the complete known module selection; malformed configuration must not
  become success-shaped defaults. Missing settings are an initialization case,
  distinct from invalid or unreadable settings.
- Treat the legacy app-wide selection only as a migration source. Preserve its
  availability for existing folders first opened later; changing one folder's
  selection must not change that source or another folder's settings. Once a folder
  has module settings, use those settings on subsequent opens.
- Classify a destination before creating module directories. Existing ClubManager
  structure or records, including a previously initialized empty structure, means
  an existing folder. No ClubManager structure or records means a new folder,
  regardless of directory age or unrelated files. Reuse existing app-owned
  structure and metadata conventions rather than infer enabled modules from file
  contents.
- Existing folders without module settings inherit the legacy selection once;
  new folders start with Meetings enabled and all other modules disabled. Preserve
  existing settings during initialization, including a concurrent first-time
  initialization by another app instance.
- Keep existing module controls, but scope them to the active usable folder and
  label that folder by its display name. Disable these controls without an active
  usable folder. Do not retain a separate global module-editing control.
- Coordinate main-process folder activation and renderer state so that folder path,
  loaded records, module selection, and visible navigation refer to the same
  committed context. Do not expose a successful switch until destination
  configuration and data are usable; activation failures retain the previous active
  folder.
- Keep the current module when enabled in the destination. Otherwise select the
  first enabled module in existing navigation order, or Settings when none is
  enabled. Existing disabled-view navigation guards must remain effective,
  including module subviews.
- Before switching folders or applying a selection that hides an edited module,
  use Save / Discard / Cancel for unsaved edits. A successful save precedes the
  transition; cancellation or save failure preserves editing state and prevents
  the transition. Apply this to affected meeting and letter editing flows without
  broad unrelated editor changes.
- Reload selection when opening a folder, switching to it, and entering Settings.
  Do not add a live file watcher. If an external refresh hides the edited module,
  apply the same unsaved-edit guard; cancelling does not write stale configuration
  back to disk.
- Use stale-state/conflict detection for module-setting writes. Reject conflicting
  saves with an explicit error and require a reload rather than overwrite unseen
  external changes. Reuse existing revision-aware persistence patterns where
  suitable; do not introduce a distributed synchronization service.
- On configuration read, validation, initialization, or save failure, report the
  error explicitly and retain the last valid state. Do not overwrite invalid
  configuration automatically. Startup has no loaded previous folder: keep
  folder-backed modules inactive, expose Settings and folder selection, and disable
  module controls until activation succeeds.
- Hiding modules never deletes or migrates their records. An empty selection is
  valid and leaves Settings, the manual, release history, and folder switching
  usable.
- Leave unrelated preferences, including sidebar width, app-wide. Preserve
  folder-local templates, stylesheets, signatures, display names, registered-folder
  recovery, and existing records.
- Update the current architecture description, product roadmap status, and German
  manual when implementing the behavior. Keep the ADR's implementation status
  accurate. A version bump is not requested; if implementation includes a new
  version, follow the existing release-note conventions.

## Testing Decisions

- The user confirmed the existing Electron application boundary as the primary
  seam, with focused Node persistence tests where needed. Prefer extending existing
  harnesses over adding a framework or test-only application API.
- Good tests observe user actions, visible navigation, prompts, error messages,
  persisted behavior, and preservation of records/drafts. Do not couple tests to
  internal call order, private helper layout, or incidental serialized formatting.
- Prior art: the Electron smoke harness already drives the real renderer and
  preload/main-process boundary, controls file-picker choices, uses temporary
  folders, tests module visibility and folder switching, and exercises Save /
  Discard / Cancel including failed saves. Extend these scenarios for folder-scoped
  selection.
- Prior art: the existing Electron folder-recovery scenarios cover
  unavailable-folder startup, relinking, portable display names, and re-registration.
  Extend this seam for unusable module configuration at startup and portability
  after reopening or relocating a folder.
- Prior art: existing Node settings tests cover legacy loading, module validation,
  and customization migration; storage tests cover safe persistence and stale-write
  rejection using temporary files. Reuse these public persistence-boundary patterns
  for deterministic initialization, migration, corruption, and conflict cases that
  are difficult to exercise reliably through the UI.
- Verify two folders with different selections remain independent across edits,
  switching, and app restart; opening the same folder from an independent
  app-settings context restores the folder-owned selection rather than app-wide
  state.
- Verify existing-folder migration, later registration of another legacy folder,
  preservation of already configured folders, Meetings-only defaults for new
  folders, unrelated-file handling, and classification before directory
  initialization. Include concurrent first-initialization protection.
- Verify Settings labels the active folder, controls are unavailable without a
  usable active folder, disabled views/subviews cannot be entered through
  navigation, and re-enabling a module reveals its unchanged saved records.
- Verify navigation after switching keeps an enabled current module, falls back
  in existing navigation order when disabled, and uses Settings for an empty
  selection. Confirm general navigation and folder switching remain usable when
  every module is disabled.
- Exercise Save, Discard, Cancel, and failed-save transitions for unsaved edits,
  including externally refreshed selections that hide the edited module. Assert
  both draft preservation and folder/selection consistency, and ensure cancellation
  never overwrites newer external settings.
- Exercise malformed/unsupported configuration, unreadable settings,
  initialization/write failures, and stale saves. Assert explicit errors, no silent
  replacement or external-file clobbering, no partial activation, and retention of
  the previous valid context. Use deterministic failure fixtures, not
  platform-dependent permission assumptions.
- Verify refresh at folder open/switch and Settings entry, conflict rejection before
  a stale save can overwrite external changes, and recovery after reload. Live
  propagation between refresh points is not required.
- Verify display-name edits and module-setting edits preserve each other's data,
  and sidebar preference plus document customizations remain unaffected. Add
  focused regression cases for behavior this feature changes, not unrelated
  baseline coverage.

## Out of Scope

- Implementing Members or Invoices beyond their existing placeholders.
- Inferring enabled modules from which records exist, path-based rules, or
  predefined module bundles.
- Per-person/per-computer module overrides or a second global configuration layer.
- Deleting records when a module is disabled, or moving data between folders.
- Authorization, permissions, or operation-level access control based on enabled
  modules.
- Live file watching, real-time cross-computer synchronization, distributed locking,
  or a new synchronization service.
- Making sidebar width or other unrelated app preferences folder-specific.
- A new test framework, broad editor refactoring, unrelated bug fixes, a release,
  or an app version bump.

## Further Notes

The product design and test seams have been confirmed with the user. This spec is
ready for implementation without another product-design interview. ADR 0002
records the rationale for choosing portable shared configuration over local
preferences or automatic detection; its proposed status describes the fact that
runtime behavior has not yet been implemented.

The repository currently implements app-wide module visibility. Do not present the
feature as shipped until implementation and focused behavioral verification are
complete. Preserve unrelated worktree changes during implementation.

Publication to the GitHub issue tracker was blocked by the GitKraken sign-in flow.
The user chose to save this spec locally instead. No issue was created and no
triage label was applied; when published, use the `ready-for-agent` label.
