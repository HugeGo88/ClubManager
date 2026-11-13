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
text. Meetings is the only implemented business module. Members, Invoices and
Letters currently have sidebar entries, settings toggles and placeholder views,
not independent business implementations. Separate data folders exist for each
module, but there is currently no cross-module data-sharing API, plugin system
or separate service. Modularity and intentional data-sharing interfaces are
future design goals, not existing guarantees.

The sidebar has a collapsible Meetings group with **Offene Aufgaben**,
**Entscheidungen**, **Alle TOPs** and **Statistiken**, plus Settings. Each module has a Settings
tab and can be disabled; only Meetings is enabled by default. A disabled module
and its navigation entries are hidden, and the renderer rejects navigation into
it. The entire Meetings heading toggles its subnavigation and opens the meeting
view when necessary; toggling while already editing a meeting preserves unsaved
edits. Settings and Versionsverlauf remain available even if all modules are disabled.
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
  dialogs and IPC handlers. The application window uses context isolation and
  sandboxing with Node integration disabled. The main process validates and
  performs privileged operations on behalf of the renderer.
- [src/main/preload.js](src/main/preload.js) exposes the restricted `window.club`
  API, wrapping `ipcRenderer.invoke` and translating common filesystem errors.
  IPC covers application version, folder selection, module settings, PDF CSS,
  meeting list/save/export, opening exported PDFs and update installation.
  Add new privileged operations through an explicit preload method and
  main-process handler rather than exposing Node or unrestricted IPC.
- Main-process write operations are serialized. User-visible errors are
  surfaced rather than silently replaced by defaults.
- [src/shared/de.js](src/shared/de.js) supplies German labels and vote
  descriptions; [src/shared/dates.js](src/shared/dates.js) shares date
  validation, local dates, formatting and overdue logic. Reuse these helpers in
  renderer and main-process output where applicable.

## Settings and persistence

- Electron's `userData/settings.json`, outside the club data folder, stores the
  chosen folder, optional PDF CSS path, four Boolean module settings and the
  last version whose changelog was displayed.
  [src/main/settings.js](src/main/settings.js) validates and persists them.
  Existing settings without module selections use the Meetings-only defaults.
- [src/shared/changelog.json](src/shared/changelog.json) is the packaged source
  of release notes displayed by the renderer through restricted IPC. Add a
  version entry for each release. The main process serializes marking the
  current version as seen only after the history is rendered; a failure is
  reported and will be retried on the next launch.
- Choosing a data folder creates `meetings/`, `members/`, `invoices/` and
  `letters/` under it. Changing folders opens the new location without moving
  existing data. An unavailable saved folder is reported; it is not silently
  recreated.
- [src/main/storage.js](src/main/storage.js) stores each meeting in
  `meetings/<UUID>.json` as `{ "version": 1, "meeting": { ... } }` and its last
  exported PDF in `meetings/protocols/<UUID>.pdf`. The meeting ID must match the
  filename. Unsupported file versions, invalid records and corrupt JSON are
  reported rather than silently skipped; there is no version migration for
  unsupported meeting formats.
- Meeting data contains a title, optional date, attendance entries and ordered
  TOPs. A TOP has a headline, `discussion`/`decision`/`info` type, Markdown
  details, optional responsible person and tasks. Tasks include description,
  responsible names, done state and optional due/completion dates. Decision
  TOPs may contain an outcome and optional vote counts. The editor disallows
  adding new tasks to a decision but preserves legacy decision tasks.
  Storage validation is the source of truth for accepted fields and dates.
- Writes use a temporary file followed by rename. SHA-256 revisions detect
  changes on disk before saves and exports; the caller must reload after a
  conflict rather than overwrite external edits. This is not a synchronization
  service, cross-process locking mechanism or replacement for backups. Club
  data is not encrypted.

## PDF protocols

[src/main/protocol.js](src/main/protocol.js) builds protocol HTML from saved
meeting data, escapes text and converts Markdown using `marked` followed by
`sanitize-html`. The main process loads it in a hidden isolated Electron window
and uses `printToPDF`; the result replaces the meeting's previous export.
Document CSP blocks external resources. The default stylesheet is
[src/shared/document.css](src/shared/document.css); a user-selected CSS file
replaces it and is reread on each export. A missing custom stylesheet is an
error, not an implicit fallback.

The PDF contains attendance grouped by status, TOPs, decision results and
tasks. Its final open-task section groups by responsible person; comma- and
semicolon-separated names place a task under each person. An optional export
checkbox includes open tasks from saved meetings with valid dates strictly
before the current meeting; the current meeting must have a valid date. The
PDF also contains the title and date, page header/footer and page numbers.

## Distribution and updates

[package.json](package.json) defines the Electron entry point, dependencies,
build scripts and electron-builder targets. The manually dispatched
[release workflow](.github/workflows/release.yml) builds macOS ARM64 DMG/ZIP
on macOS and a Windows x64 NSIS installer on Windows, then publishes a GitHub
Release and update metadata after successful builds. Release versioning,
signing/notarization secrets and operational steps are documented in the
[README](README.md); never put credentials in the repository. Local macOS
builds may be unsigned, while the release workflow requires signing and
notarization; Windows signing and Linux packaging remain open.

[src/main/updates.js](src/main/updates.js) uses `electron-updater` for packaged
macOS and Windows builds: updates download in the background and require user
confirmation before installation. The renderer can guard unsaved meeting edits
before restart. Update errors are reported. Source-mode runs do not check for
updates, and real-device signing, release and update verification remain
separate operational steps.

## Renderer and interactions

- [src/renderer/index.html](src/renderer/index.html) defines the sidebar,
  application container, local scripts and content security policy.
- [src/renderer/renderer.js](src/renderer/renderer.js) is a vanilla JavaScript
  UI: module-level state, HTML template functions, delegated event handlers and
  an explicit `render()` cycle. It escapes user content inserted into HTML.
  Async button actions make the body inert, handle failures as visible notices
  and then re-render. Navigation checks for unsaved meeting edits.
- The meeting editor works on a clone of the selected saved record, tracks a
  revision and dirty flag, and requires a save before exporting. A generated PDF
  is a snapshot, not automatically updated when the meeting changes.
- Open Tasks aggregates unfinished tasks from saved meetings, filters and sorts
  them, and marks a task complete via an immediate revision-checked save. A
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
| [.github/workflows/release.yml](.github/workflows/release.yml) | Manually triggered build and release |
| [.vscode/](.vscode/) | Electron main-process launch and debug tasks |
| [docs/screenshots/](docs/screenshots/) | README screenshots using fictional data |

## Development and verification

Use the Node.js version requirement and installation instructions in the
[README](README.md). Common commands:

```sh
npm install
npm start
npm test
npm run test:electron
npm run build:editor
npm run dist:mac
npm run dist:win
```

`npm test` runs Node's test runner. The Electron smoke test requires a graphical
desktop and exercises the application through Electron, including meeting
editing, navigation, settings, lists, conflicts and PDF export; it also checks
expected failure paths. The `start`, Electron smoke test and distribution scripts
build the editor through npm lifecycle scripts. VS Code's debug configurations
also run the editor build first.
