# ClubManager architecture

This document describes the **current implementation**, not a specification for
future modules. Use it as a starting point for a new session, then verify the
relevant code before making changes. [PRODUCT_IDEAS.md](PRODUCT_IDEAS.md) tracks
product goals and unfinished ideas; [README.md](README.md) covers user setup,
usage, packaging and release credentials.

## Maintenance

When a change affects architecture, module boundaries, data formats, behavior,
security, build, testing or release workflows, update the affected sections in
this document in the same change. Remove or revise outdated statements rather
than keeping an append-only history. Do not document planned work as implemented.
The project-wide Copilot instruction in
[.github/copilot-instructions.md](.github/copilot-instructions.md) asks future
agents to read and maintain this document; human contributors should follow the
same rule. Instructions guide future work but cannot guarantee compliance by
every tool or contributor.

## Product and module boundaries

ClubManager is a local Electron desktop application with German user-facing
text. Meetings and single-recipient Letters are implemented. Members and Invoices
currently have sidebar entries, settings toggles and placeholder views,
not independent business implementations. Separate data folders exist for each
module, but there is currently no cross-module data-sharing API, plugin system
or separate service. Modularity and intentional data-sharing interfaces are
future design goals, not existing guarantees.

The sidebar's C button toggles an icon-only layout with native title tooltips;
the setting is persisted. Related module icons share a color. Sidebar Material
Icons are provided by a locally packaged font, with no network request.
The sidebar has a collapsible Meetings group with **Offene Aufgaben**,
**Entscheidungen**, **Alle TOPs** and **Statistiken**, plus Settings. Each module has a Settings
tab and can be disabled; only Meetings is enabled by default. A disabled module
and its navigation entries are hidden, and the renderer rejects navigation into
it. The entire Meetings heading toggles its subnavigation and opens the meeting
view when necessary; toggling while already editing a meeting preserves unsaved
edits. Handbuch, Settings and Versionsverlauf remain available even if all modules are disabled.
The version history opens on first launch of each version, including fresh
installs and legacy settings without a version marker.

## Processes and data flow

```text
Renderer: views, UI state, CodeMirror
    | window.club methods (contextBridge)
Preload: restricted IPC and localized error messages
    | Electron IPC
Main: dialogs, validation, storage, PDF, updates
    |                         |
settings.json in userData    user-selected data folder
```

- [src/main/main.js](src/main/main.js) manages the Electron lifecycle, window,
  dialogs and IPC handlers. It disables the native application menu on all
  platforms. The application window uses context isolation and sandboxing
  with Node integration disabled. The main process validates and performs
  privileged operations on behalf of the renderer. It displays the lightweight
  splash before loading app main-process modules, then initiates the update check
  while keeping the splash visible. The hidden app window loads saved settings,
  the active registered data folder and its first view. If a new version is available,
  it is downloaded and installed automatically with status messages shown on
  the splash screen via a restricted preload. On Linux, startup waits for this
  check and any download before the main window opens. A startup IPC handshake keeps
  settings access behind initialization and closes the splash only after the
  first render or after update installation. The renderer loads independent
  settings and release-note requests in parallel.
- [src/main/preload.js](src/main/preload.js) exposes the restricted `window.club`
  API, wrapping `ipcRenderer.invoke` and translating common filesystem errors.
  IPC covers application version, folder selection, registry, activation and
  renaming, module settings, folder-local document customization import, reset
  and directory opening, PDF CSS,
  meeting list/save/export, opening exported PDFs, reading an existing meeting
  PDF for its resizable in-app preview and update installation.
  Add new privileged operations through an explicit preload method and
  main-process handler rather than exposing Node or unrestricted IPC.
- Main-process write operations are serialized. User-visible errors are
  surfaced rather than silently replaced by defaults.
- [src/shared/de.js](src/shared/de.js) supplies German labels and vote
  descriptions; [src/shared/dates.js](src/shared/dates.js) shares date
  validation, local dates, formatting and overdue logic. Reuse these helpers in
  renderer and main-process output where applicable.

## Settings and persistence

- Electron's `userData/settings.json`, outside the club data folders, stores the
  registered folder paths and display names plus the active folder path,
  legacy app-wide customization paths until they are migrated, four Boolean
  module settings, sidebar width preference and the
  last version whose changelog was displayed.
  [src/main/settings.js](src/main/settings.js) validates and persists them.
  Signatures are stored only within each folder's customization directory (never
  app-wide), so each folder maintains an independent signature library.
  Current document customizations live inside each data folder:
  `customizations/pdf.css`, `customizations/meeting.html`,
  `customizations/letter.html` and `customizations/signatures/`. The signatures
  directory includes a versioned manifest and copied image files. Missing
  customization files are independent; each uses its packaged default.
  Imports copy validated files into these standard locations, so exports do
  not depend on the source path. CSS syntax and HTML template placeholders are
  validated before import. Users can open the customization directory
  and reset each template or stylesheet after confirmation.
  Legacy app-wide templates, CSS and signatures migrate into the active folder,
  or the first selected folder when there is no active folder. Existing
  destination files are preserved and reported as conflicts. Unreadable legacy
  files and filesystem failures are surfaced and do not silently fall back.
  A legacy single `folder` setting loads as one registered folder named after
  its final path component. Existing settings without module selections use the
  Meetings-only defaults. Module visibility and the sidebar preference remain
  app-wide rather than following the active folder.
- [src/shared/changelog.json](src/shared/changelog.json) is the packaged source
  of release notes displayed by the renderer through restricted IPC. New entries
  include the release date as an ISO `YYYY-MM-DD` value, displayed in German
  date format, and group changes in named module or Allgemein sections; legacy
  flat entries remain supported. Historical entries without dates remain
  supported. Add a dated version entry for each release. The main process
  serializes marking the current version as seen only after the history is
  rendered; a failure is reported and will be retried on the next launch.
- [src/shared/manual.md](src/shared/manual.md) is the maintained German user
  guide. `npm run build:manual` packages its text together with the version in
  `package.json` as `src/shared/generated/manual.json`. On navigation, the main
  process checks that version against the running app and renders sanitized
  Markdown through restricted IPC; missing, invalid or mismatched manuals
  produce an error. Each build generates the current version's manual, not an
  archive or automatically authored content.
- Registered data folders are stored in `settings.json` with a path, display name,
  and availability flag. Availability is rechecked from the filesystem at startup
  and when displayed; it is not cached as permanent state. Choosing a data folder
  registers it and creates `meetings/`, `members/`, `invoices/` and `letters/` under it.
  The header selector shows available registered folders; unavailable folders are marked
  and disabled in the selector. The Settings page lists all registered folders with
  their status, allowing users to rename, relink (reconnect to a new path while preserving
  the display name and registration), or unregister (remove the registration without deleting
  folder contents) any folder. Changing folders opens the new location without moving
  existing data. When there are unsaved edits, the renderer offers save, discard or cancel;
  a failed save prevents switching and preserves the current draft. If the active folder
  becomes unavailable at startup, it is cleared, no folder-backed data loads, the app does
  not silently recreate it, and the user is guided to choose or relink a folder. An
  unavailable folder cannot be activated until it is successfully relinked to an available
  path. Unregistering a folder removes only its registration and never deletes or modifies
  folder contents. Unregistering the active folder clears the active selection and guides
  the user to select another folder without implicitly switching.
- [src/main/storage.js](src/main/storage.js) stores each meeting in
  `meetings/<UUID>.json` as `{ "version": 1, "meeting": { ... } }` and its last
  exported PDF in `meetings/protocols/<UUID>.pdf`. The meeting ID must match the
  filename. Unsupported file versions, invalid records and corrupt JSON are
  reported rather than silently skipped; startup reads meeting records in
  batches of at most eight files to reduce serial I/O without unbounded
  concurrency. There is no version migration for unsupported meeting formats.
- Meeting data contains a title, optional date, an optional recorder name, an
  optional Boolean `readOnly` flag (absent in legacy records), attendance entries and ordered
  TOPs. A TOP has a headline, `discussion`/`decision`/`info` type, Markdown
  details, optional responsible person and tasks. Tasks include description,
  responsible names, done state and optional due/completion dates. Decision
  TOPs may contain an outcome and optional vote counts. The editor disallows
  adding new tasks to a decision but preserves legacy decision tasks.
  Storage validation is the source of truth for accepted fields and dates. The
  saved-meetings list shows a lock icon and accessible read-only label for
  records whose saved `readOnly` value is `true`; an absent legacy value is
  treated as editable.
- [src/main/letters.js](src/main/letters.js) stores individual letters as
  versioned `letters/<UUID>.json` files and their PDFs in `letters/pdf/`.
  Letters have optional manually entered structured addresses (company, name,
  street, postal code and city) and signature IDs. Legacy multiline address
  strings load into the name field without guessing their components and are
  stored in structured form on the next save.
  Each data folder's signature manifest contains local image filenames; imports
  copy images into that folder. Missing images or removed signature entries
  cause an export error. SVG and raster images are decoded
  in an isolated window and rasterized before embedding.
- Writes use a temporary file followed by rename. SHA-256 revisions detect
  changes on disk before saves and exports; the caller must reload after a
  conflict rather than overwrite external edits. This is not a synchronization
  service, cross-process locking mechanism or replacement for backups. Club
  data is not encrypted.

[src/main/protocol.js](src/main/protocol.js) builds protocol HTML from saved
meeting data, escapes text and converts Markdown using `marked` followed by
`sanitize-html`. The main process loads it in a hidden isolated Electron window
and uses `printToPDF`; the result replaces the meeting's previous export.
Document CSP blocks external resources. The packaged default stylesheets are
[src/shared/document.css](src/shared/document.css) for Meetings and
[src/shared/letter.css](src/shared/letter.css) for Letters. A data folder's
optional `customizations/pdf.css` replaces the stylesheet for both PDF types
and is reread on each export; it does not affect the app UI. Missing local CSS
or templates independently use their corresponding packaged defaults. Present
but unreadable or invalid custom files are errors rather than fallbacks.
The optional meeting-specific HTML body template places escaped title/date and
recorder name and generated attendance, TOP and open-task sections using
documented placeholders, including `{{recorder}}`;
template HTML is sanitized and validated both on import and export. Without a
local template the existing built-in layout is used.

The PDF contains attendance grouped by status, TOPs, decision results and
tasks, plus the optional recorder name. Its final open-task section groups by responsible person; comma- and
semicolon-separated names place a task under each person. An optional export
checkbox includes open tasks from saved meetings with valid dates strictly
before the current meeting; the current meeting must have a valid date. The
PDF also contains the title and date, page header/footer and page numbers.

## Distribution and updates

[package.json](package.json) defines the Electron entry point, dependencies,
build scripts and electron-builder targets. The
[release workflow](.github/workflows/release.yml) runs manually or when a push
to `main` changes the package version. It checks matching lockfile versions and
a nonempty changelog entry before generating app assets and building macOS ARM64 DMG/ZIP
on macOS, a Windows x64 NSIS installer on Windows and an Ubuntu x64 `.deb`
package on Ubuntu, then publishes a GitHub Release and platform update
metadata after successful builds. Release versioning,
signing/notarization secrets and operational steps are documented in the
[README](README.md); never put credentials in the repository. Local macOS
builds may be unsigned, while the release workflow requires signing and
notarization; Windows signing remains open. Ubuntu package installation and
updates still need verification on a real Ubuntu installation.

[src/main/updates.js](src/main/updates.js) uses `electron-updater` for packaged
macOS, Windows and Ubuntu `.deb` builds. On startup,
updates are checked automatically and downloaded in the background. If a new
version is available, installation starts automatically, with status messages
displayed on the splash screen. This provides a seamless
update experience. On Linux, startup waits for the update check and any download
and installation attempt before opening the application window, avoiding
interrupting edits; installation may require administrator authentication.
Linux update errors are shown to the user. The renderer can guard
unsaved meeting edits before restart. Update errors are reported. Source-mode
runs do not check for updates, and real-device signing, release and update
verification remain separate operational steps.

## Renderer and interactions

- [src/renderer/index.html](src/renderer/index.html) defines the sidebar,
  application container, local scripts and content security policy.
- [src/renderer/renderer.js](src/renderer/renderer.js) is a vanilla JavaScript
  UI: module-level state, HTML template functions, delegated event handlers and
  an explicit `render()` cycle. Electron starts Chromium with the `de-DE`
  locale so native date controls display German dates and start weeks on Monday.
  The renderer escapes user content inserted into HTML.
  Async button actions make the body inert, handle failures as visible notices
  and then re-render. Navigation checks for unsaved meeting edits.
- The meeting editor works on a clone of the selected saved record, tracks a
  revision and dirty flag, and requires a save before exporting. A generated PDF
  is a snapshot, not automatically updated when the meeting changes. A saved
  read-only flag disables editing protocol content in the UI; disabling it
  requires confirmation. Task completion and reopening remain available in the
  editor and task overview. This is an accidental-edit guard, not file access
  control; toggles and editor task changes follow the normal save workflow.
- The letter editor similarly tracks unsaved changes and revisions, uses the
  shared Markdown editor, and exports saved content with optional address and
  selected signatures from the active data folder. Letter templates use
  sanitized body fragments with documented placeholders; the folder's shared
  PDF CSS overrides the packaged default.
- Meeting and letter lists filter saved records by title or displayed/ISO date
  as the user types. Each search remains in renderer memory independently and
  updating results leaves the open editor and its unsaved changes untouched.
- Open Tasks aggregates saved meeting tasks, optionally includes completed tasks,
  and filters and sorts an overdue-open table and a separate remaining-tasks table.
  Its sidebar badge counts all overdue open tasks independently of filters and
  updates on saved changes, refresh, local midnight and return to the app.
  The view expands each task's corresponding TOP details across the table and
  completes or reopens tasks via an immediate revision-checked save. A
  local completion date is set on completion and cleared when reopened;
  overdue display uses the local date and refreshes when the day changes.
- Statistics shows current open, completed and overdue task counts across all
  saved meetings, plus an estimated end-of-day open-task trend and a table of
  its points. [src/shared/task-statistics.js](src/shared/task-statistics.js)
  treats the meeting date as the task start and the stored completion date as
  its end. Tasks with invalid, missing, future or inconsistent dates are
  excluded from the trend and counted separately, not from current totals.
  Task creation, deletion and reopening history is not recorded, so this is not
  an exact historical burndown. Changing meetings can change past estimates.
- Decisions aggregates decision TOPs from saved meetings and supports combined
  text and outcome filters, including grouped accepted and rejected outcomes,
  expanding TOP details across the table and opening the source meeting.
  All TOPs aggregates every saved TOP,
  searches title, details, person, type, meeting and date, and combines type and
  meeting filters. Details expand across the table and the source meeting can
  be opened. These views do not depend on the presence of an exported PDF.
- [src/renderer/markdown-editor.js](src/renderer/markdown-editor.js) implements
  a CodeMirror editor with inline Markdown decorations, format controls and
  interactive Markdown checkboxes. Markdown is stored as text; those checkboxes
  are separate from meeting tasks. The renderer destroys and recreates editors
  during full renders. Its generated browser bundle under
  `src/renderer/generated/` is built by `npm run build:editor` and is ignored by
  Git; edit the source, not the bundle.
- [src/renderer/style.css](src/renderer/style.css) styles the application.
  TOP type badges in the overview use the default PDF type colors; changes to
  one should consider the other.

## Repository map

| Path | Responsibility |
| --- | --- |
| [src/main/](src/main/) | Electron main process, persistence, settings, PDF and updates |
| [src/renderer/](src/renderer/) | Navigation, UI state, views, styles and Markdown editor |
| [src/shared/](src/shared/) | Shared labels, dates and default document CSS |
| [test/](test/) | Node tests for dates, settings, storage, protocols and updates |
| [scripts/electron-smoke.cjs](scripts/electron-smoke.cjs) | Graphical end-to-end Electron smoke test |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Pull-request tests and Electron smoke check |
| [.github/workflows/release.yml](.github/workflows/release.yml) | Version-triggered or manually dispatched build and release |
| [.vscode/](.vscode/) | Electron main-process launch and debug tasks |
| [docs/screenshots/](docs/screenshots/) | README screenshots using fictional data |

## Development and verification

Use Node.js 22.12.0 from `.nvmrc` and the installation instructions in the
[README](README.md). The CI and release workflows select the same version from
that file. Common commands:

```sh
npm install
npm start
npm test
npm run test:electron
npm run build:assets
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`npm test` runs Node's test runner. The test scripts check that Node meets the
minimum version in `.nvmrc` before running. The Electron smoke tests exercise the application through Electron, including
meeting editing, navigation, settings, lists, conflicts and PDF export. They
also verify copied customizations, reset/default behavior, and PDF output when
switching between two folders; a separate process verifies unavailable-folder
startup recovery, relinking and non-destructive unregister.
The pull-request workflow runs both suites and checks the smoke-test scripts'
syntax, providing a virtual display for Electron. The `start`, Electron smoke
test and distribution scripts build the editor and versioned manual through npm
lifecycle scripts. VS Code's debug configurations also build these assets first.
