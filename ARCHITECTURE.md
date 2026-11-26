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
text. Meetings, single-recipient Letters, and invoice drafts with ZUGFeRD issuance
are implemented.
Members is a placeholder; Invoices also includes a read-only calendar.
Separate data folders exist for each
module, but there is currently no cross-module data-sharing API, plugin system
or separate service. Modularity and intentional data-sharing interfaces are
future design goals, not existing guarantees.

The sidebar's app-icon button toggles an icon-only layout with native title tooltips;
the setting is persisted. Related module icons share a color. Sidebar Material
Icons are provided by a locally packaged font, with no network request.
The sidebar has a collapsible Meetings group with **Offene Aufgaben**,
**Entscheidungen**, **Alle TOPs** and **Statistiken**, and a collapsible Invoices
group with **Kalender**, plus Settings. Each module has a Settings
tab and can be disabled; only Meetings is enabled by default. A disabled module
and its navigation entries are hidden, and the renderer rejects navigation into
it. The entire Meetings heading toggles its subnavigation and opens the meeting
view when necessary; toggling while already editing a meeting preserves unsaved
edits. The Invoices heading likewise toggles its subnavigation and opens the
Invoices view when necessary. Handbuch, Settings and Versionsverlauf remain available even if all modules are disabled.
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
  splash before loading app main-process modules, then runs the startup sequence
  strictly in order: network availability, update check, update installation
  when available, and data-folder loading. The splash remains visible and
  reports startup status through a restricted preload. Fatal errors require user
  acknowledgment before the app exits; non-fatal folder errors allow startup
  to continue. The hidden app window is not shown until the sequence completes,
  then a startup IPC handshake closes the splash only after the renderer reports
  that it is ready. If the data folder is unavailable, the renderer receives a
  null folder and keeps settings and folder selection available while guarding
  folder-backed views and operations. Source-mode runs do not perform updates.
- [src/main/preload.js](src/main/preload.js) exposes the restricted `window.club`
  API, wrapping `ipcRenderer.invoke` and translating common filesystem errors.
  IPC covers application version, folder selection, registry, activation and
  renaming, module settings, folder-local document customization import, reset
  and directory opening, PDF CSS,
  meeting list/save/delete/export, invoice draft/settings/issuance/PDF
  preview/download, invoice payment recording/editing/deletion, opening exported
  PDFs, reading existing meeting and letter
  PDFs for their resizable in-app previews and update installation.
  Add new privileged operations through an explicit preload method and
  main-process handler rather than exposing Node or unrestricted IPC.
- Online calendar configuration is folder-local in `clubmanager-calendar.json`;
  the last successful response and observed event and occurrence history are
  atomically stored together in `clubmanager-calendar-cache.json`; history is
  separate for each normalized source URL and records its fetch time, while
  only the latest source's response retains its live snapshot. Missing
  events and individual occurrences are retained until two years after their end; active feed
  entries remain visible regardless of age, replace matching history, and
  explicit cancellations and recurrence exclusions remove entries until
  actively reinstated, including every saved occurrence on series cancellation.
  Recurrence identities use the UID and original occurrence instant so moved
  instances replace their previous version. UID-less content matching cannot
  reliably identify changed events; for series the recurrence rule and exclusions
  are excluded from the fingerprint, so identical otherwise-indistinguishable
  series cannot be distinguished. UID-less cancellations cannot reliably identify
  an earlier event. Version 1 and earlier
  version 2 caches are migrated on refresh or offline load. Their generated
  UUID-v4-shaped IDs have ambiguous provenance and their original VEVENT
  contents are unavailable; such cached standalone-looking events are seeded
  with their existing IDs, so a later UID-less feed entry can appear alongside
  its cached predecessor. Occurrence-shaped IDs are not seeded, which can be
  ambiguous for unusual UID values.
  Events absent from that cache cannot be recovered. Each configuration save
  changes its revision even when a URL is restored, and the active-folder epoch
  also rejects in-flight results after a folder switch away and back. A
  folder-local lock serializes configuration and
  cache commits across app processes; completion timestamps ensure that the
  last successful concurrent refresh wins. Failed requests or cache writes
  preserve the previous cache. The restricted preload exposes loading, saving
  and fetching; the main process validates URLs and performs privileged HTTP(S)
  requests, rejects stale folder or source results, and falls back to a
  matching cache with an explicit stale warning. ICS parsing uses `ical.js`
  for VEVENT date, timezone, recurrence and exception handling; timed values
  are stored as UTC ISO timestamps for computer-local display, while all-day
  values keep date-only boundaries and are not shifted across time zones.
  The renderer keeps only parsed text and renders the read-only Monday-first
  month grid with the last successful fetch time. Subscription
  titles, locations and descriptions are escaped text, never HTML. Event buttons
  open read-only native dialogs; crowded days show only a bounded grid selection
  and expose the remaining events through a separate overflow dialog. Multi-day
  events occupy continuous, non-overlapping bars within each week and wrap to
  the next week; a segment without a free row is available in the overflow for
  each day it covers. Enabling
  Rechnungen exposes Kalender as a submodule; disabling Rechnungen hides both
  Rechnung views and rejects navigation to them.
- Invoice drafts are folder-local records below `invoices/`, while issuer,
  bank, payment-term and invoice-number settings are stored in the same module
  directory. Issuance reserves a prefix/year/sequence number, freezes the
  invoice and issuer data, and stores the initial PDF under `invoices/pdf/`.
  Issued records cannot be edited or issued again. A deliberate layout
  redesign reuses the frozen snapshot and must produce the same invoice XML
  hash; it appends a PDF revision without changing invoice facts or number.
  The first PDF remains at `<invoice-id>.pdf`; later revisions use
  `<invoice-id>-<revision-id>.pdf`. The issued record keeps stable revision IDs,
  hashes and creation times, and points to the latest revision. PDF bytes are
  SHA-256 checked when any revision is previewed or downloaded. A failed
  redesign removes only its uncommitted file and leaves the record and earlier
  PDFs intact. The main process serializes writes, and an inter-process invoice
  lock prevents concurrent saves, issuance and redesign of the same invoice.
  Number reservation uses exclusive file creation to avoid duplicate numbers
  across processes sharing the folder.
  Prices are entered in euros but stored as integer cents; the shared invoice
  amount helpers calculate editor, list and document totals using exact
  decimal-to-cent rounding. Every position is rounded Half-up independently
  before totals are summed. The HTML preview uses a sandboxed blob frame and
  escapes all user values. Draft writes use SHA-256 revisions and
  atomic replacement; stale or invalid writes are rejected with German errors.
  Issued PDFs and redesigns are generated locally from sanitized HTML, contain
  validated EN-16931 CII XML and an EPC GiroCode QR, and are checked with the
  ZUGFeRD dependency's PDF/A validation subset before storage. This check is not
  a full independent veraPDF conformance report. Invoice tax is currently
  fixed to the EN-16931 outside-scope category; VAT calculation, cancellation
  and correction workflows are not implemented.
- Manual payments are recorded per issued invoice as dated, positive integer-cent
  entries stored in the invoice record; drafts reject payment recording, and an
  email send is never required. Payments never change invoice facts, the issued
  snapshot, the XML or stored PDFs, and their sum may not exceed the invoice
  total — overpayments, zero and negative amounts are rejected on recording,
  editing and when reading stored records. Entries can be edited and deleted
  until the invoice is fully paid; a fully paid invoice permanently locks all
  its payment entries with no unlock, refund or correction history. The lock is
  enforced in the renderer UI and again in the privileged main-process
  operations. List and detail views derive the unpaid/partially paid/paid
  state, the outstanding balance and the overdue flag (issued, outstanding
  balance, past due date) through the shared
  [src/shared/invoice-payments.js](src/shared/invoice-payments.js) helper.
  After a partial payment the invoice shows a visible warning that the GiroCode
  in the issued PDF still carries the original total; no remainder QR code is
  generated and the PDF is not silently regenerated. Payment writes use the
  same inter-process invoice lock and SHA-256 revision checks as other invoice
  writes, and a changed active folder is an explicit error.
- In Letters and Meetings, the renderer keeps the PDF preview open and at the
  same width when selecting another saved item from the list. It replaces the
  PDF with that item's export or shows a missing/unreadable message. Selection
  holds the existing interaction lock until the editor and preview can update
  together. Re-exporting the selected item does not replace the open snapshot.
- Main-process write operations are serialized. User-visible errors are
  surfaced rather than silently replaced by defaults.
- [src/shared/de.js](src/shared/de.js) supplies German labels and vote
  descriptions; [src/shared/dates.js](src/shared/dates.js) shares date
  validation, local dates, formatting and overdue logic;
  [src/shared/invoice-payments.js](src/shared/invoice-payments.js) shares
  invoice payment-state and status-label logic. Reuse these helpers in
  renderer and main-process output where applicable.

## Settings and persistence

- Electron's `userData/settings.json`, outside the club data folders, stores the
  registered folder paths and display names plus the active folder path,
  legacy app-wide customization paths until they are migrated, the legacy
  module-selection migration source, sidebar width preference and the
  last version whose changelog was displayed.
  [src/main/settings.js](src/main/settings.js) validates and persists them.
  Signatures are stored only within each folder's customization directory (never
  app-wide), so each folder maintains an independent signature library.
  Current document customizations live inside each data folder:
  `customizations/pdf.css`, `customizations/meeting.html`,
  `customizations/invoice.html`, `customizations/letter.html`,
  `customizations/letter-placeholders.json` and
  `customizations/signatures/`. The signatures directory includes a versioned
  manifest and copied image files. The letter-placeholder file is a versioned,
  folder-local list of unique lowercase keys and single-line text values shared
  by all letters in that folder; a missing file means no custom placeholders.
  Built-in letter keys are reserved.
  Settings values are HTML-escaped and can be used in the Markdown letter body
  and in text content of a letter template, not template attributes. Unknown
  keys fail template validation and export rather than being silently omitted.
  Saves compare the loaded revision before atomic replacement; conflicts require
  reloading the values. Missing CSS and template files are independent; each
  uses its packaged default.
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
  Meetings-only defaults. The sidebar preference remains app-wide.
- Each data folder owns `clubmanager-modules.json`, a version 1 record containing
  a complete validated Boolean selection. Before creating module directories,
  a folder with existing module or customization structure inherits the
  preserved legacy app-wide selection if its selection is missing; a folder
  without that structure starts with Meetings only. Exclusive initialization
  loads and validates the winning file. The registration remembers whether a
  valid selection was seen, so a missing file in a known folder is an error
  even on restart. The marker is not a copy or override of the selection.
  Invalid, unreadable or unwritable settings are reported rather than silently
  replaced. Module and display-name settings use separate files.
  Folder activation validates the selection and records before committing the
  active context; failure retains the prior context. At startup with unusable
  settings, folder-backed navigation is disabled and Settings remains usable.
  Module controls display the active folder name and are disabled without a
  usable folder. The current module remains selected on a switch if enabled,
  otherwise navigation falls back to the first enabled module or Settings.
  Hiding a module does not delete records and is not an authorization boundary.
  Opening or switching folders, entering Settings and explicitly reloading
  read the selection from disk. There is no watcher. The renderer keeps the
  revision of the selection it actually applied, even when it declines a
  refresh. Saves compare that revision with the file's contents and identity,
  including a final check before renaming the staged file. A change observed
  by that check rejects the save and requires a reload. A write after that
  check but before the rename can still be overwritten. This is optimistic
  conflict detection, not a cross-computer lock or atomic compare-and-swap.
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
- Registered data folders are stored in `settings.json` with a path, last known
  display name, and availability flag. Each folder owns its display name in
  `clubmanager-folder.json` (`{ "version": 1, "name": "…" }`). ClubManager reads
  it at startup and when listing, activating, registering, or relinking folders.
  If the file is absent, ClubManager saves the last known name for a registered
  or relinked folder, or uses the directory name for a new registration. A name
  file error is reported without blocking access to otherwise readable records:
  the last known name or directory name is displayed, and invalid metadata is
  not automatically overwritten. Renaming requires a successful write to the
  data folder. Availability is rechecked from the filesystem. Choosing a data
  folder registers it and creates `meetings/`, `members/`, `invoices/` and `letters/`.
  The header selector shows available registered folders; unavailable folders are marked
  and disabled in the selector. The Settings page lists all registered folders with
  their status, allowing users to rename the active folder when available,
  relink an unavailable folder (reconnect to a new path while preserving the
  registration), or unregister a folder (remove the registration without changing
  folder contents). Changing folders opens the new location without moving
  existing data. When there are unsaved edits, the renderer offers save, discard or cancel;
  a failed save prevents switching and preserves the current draft. Settings can be
  opened without abandoning a meeting or letter editor. A module selection that
  would hide that editor uses the same guard before writing or applying the selection;
  unrelated changes do not prompt. Cancel or save failure keeps the draft and
  previous selection. If the selection write fails after a successful draft save,
  the saved editor and previous selection remain available. An external refresh
  uses the same guard and never writes the module selection, even if the user
  saves a draft before applying it. If the active folder
  becomes unavailable at startup, it is cleared, no folder-backed data loads, the app does
  not silently recreate it, and the user is guided to choose or relink a folder. An
  unavailable folder cannot be activated until it is successfully relinked to an available
  path. Unregistering a folder removes only its registration and never deletes or modifies
  folder contents.   Unregistering the active folder also guards an open draft, clears the active selection and guides
  the user to select another folder without implicitly switching.
- [src/main/storage.js](src/main/storage.js) stores each meeting in
  `meetings/<UUID>.json` as `{ "version": 1, "meeting": { ... } }` and its last
  exported PDF in `meetings/protocols/<UUID>.pdf`. The meeting ID must match the
  filename. Unsupported file versions, invalid records and corrupt JSON are
  reported rather than silently skipped; startup reads meeting records in
  batches of at most eight files to reduce serial I/O without unbounded
  concurrency. Deleting a saved meeting checks its loaded revision and removes
  its JSON record and exported PDF; a changed or missing record is rejected.
  There is no version migration for unsupported meeting formats.
- Meeting data contains a title, optional date, optional chair and recorder names, an
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
  changes on disk at the checks before saves and exports; the caller must reload
  after a detected conflict. These checks do not protect against writes racing
  after the last check and before replacement. This is not a synchronization
  service, cross-process locking mechanism or replacement for backups. Club data
  is not encrypted.

[src/main/protocol.js](src/main/protocol.js) builds protocol HTML from saved
meeting data, escapes text and converts Markdown using `marked` followed by
`sanitize-html`. The main process loads it in a hidden isolated Electron window
and uses `printToPDF`; the result replaces the meeting's previous export.
Document CSP blocks external resources. The packaged default stylesheets are
[src/shared/document.css](src/shared/document.css) for Meetings and
[src/shared/letter.css](src/shared/letter.css) for Letters. A data folder's
optional `customizations/pdf.css` is shared by Meetings, Invoices and Letters
and is reread for every generated document; it does not affect the app UI.
Missing local CSS or templates independently use their corresponding packaged
defaults. Present but unreadable or invalid custom files are errors rather
than fallbacks.
The optional meeting-specific HTML body template places escaped title/date,
chair and recorder names and generated attendance, TOP and open-task sections using
documented placeholders, including `{{chair}}` and `{{recorder}}`;
template HTML is sanitized and validated both on import and export. Without a
local template the existing built-in layout is used.
The optional letter-specific HTML body template places the address, date, title,
content and signatures using their documented placeholders. The packaged letter
stylesheet requests Source Sans Pro with system sans-serif fallbacks.
The packaged invoice template is [src/shared/invoice.html](src/shared/invoice.html);
the optional folder-local `customizations/invoice.html` is imported and reset
through Rechnungseinstellungen. It accepts documented invoice-field tokens
only in visible text nodes; required tokens cannot be supplied by comments,
attributes, scripts or hidden regions. Unknown tokens, scripts, unsupported
elements and unsafe token locations fail import and output. User data is
escaped as text; only the generated positions table and GiroCode markup are
inserted as HTML. No template loops, conditions or custom-field registry are
provided. Draft preview uses the selected invoice template and shared PDF CSS.
Re-layout of an issued invoice appends a durable revision; the latest is the
default preview/download while earlier revisions remain selectable.

The PDF contains attendance grouped by status, TOPs, decision results and
tasks, plus the optional chair and recorder names. Its final open-task section groups by responsible person; comma- and
semicolon-separated names place a task under each person. An optional export
checkbox includes open tasks from saved meetings with valid dates strictly
before the current meeting; the current meeting must have a valid date. The
PDF also contains the title and date, page header/footer and page numbers.

## Distribution and updates

[package.json](package.json) defines the Electron entry point, dependencies,
build scripts and electron-builder targets. The
[build/icon.png](build/icon.png) source and packaged macOS ICNS icon are used for
application and window branding across platforms.
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
macOS, Windows and Ubuntu `.deb` builds. The startup sequence checks network
availability before it checks for updates. On packaged builds, update checks
and installation run sequentially after the network check and before folder
loading. If a new version is available, installation starts automatically, with
status and fatal errors shown on the splash screen. Installation may require
administrator authentication on Ubuntu. The splash and main window remain
coordinated across platforms by the startup IPC handshake. Source-mode runs do
not check for updates, and real-device signing, release and update verification
remain separate operational steps.

## Renderer and interactions

- [src/renderer/index.html](src/renderer/index.html) defines the sidebar,
  application container, local scripts and content security policy.
- [src/renderer/renderer.js](src/renderer/renderer.js) is a vanilla JavaScript
  UI: module-level state, HTML template functions, delegated event handlers and
  an explicit `render()` cycle. Electron starts Chromium with the `de-DE`
  locale so native date controls display German dates and start weeks on Monday.
  The renderer escapes user content inserted into HTML.
  Async button actions make the body inert, handle failures as visible notices
  and then re-render. Navigation checks for unsaved meeting and letter edits;
  moving between an editor and Settings retains the editor.
- The meeting editor works on a clone of the selected saved record, tracks a
  revision and dirty flag, and requires a save before exporting. A generated PDF
  is a snapshot, not automatically updated when the meeting changes. A saved
  read-only flag disables editing protocol content in the UI; disabling it
  requires confirmation. Task completion and reopening remain available in the
  editor and task overview. This is an accidental-edit guard, not file access
  control; toggles and editor task changes follow the normal save workflow.
  Saved meetings can be deleted from the editor after confirmation; unsaved
  changes must be discarded first, and stale revisions cannot delete a newer
  saved record.
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
| [scripts/electron-invoice-smoke.cjs](scripts/electron-invoice-smoke.cjs) | Focused invoice issuance and saved-PDF Electron smoke test |
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
npm run lint:smoke
npm run test:electron
npm run test:electron:invoices
npm run build:assets
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`npm test` runs Node's test runner. The test scripts check that Node meets the
minimum version in `.nvmrc` before running. Calendar cache-write failure tests
inject an error at the atomic rename rather than relying on platform-specific
directory permissions. The Electron smoke tests exercise the application through Electron, including
meeting and letter draft decisions for folder and module transitions, navigation,
settings, lists, conflicts and PDF export. They
also verify copied customizations, reset/default behavior, and PDF output when
switching between two folders; separate processes verify unavailable-folder
and configuration recovery, relinking, non-destructive unregister, a
deterministic initialization-write failure and retry, guarded external refresh,
stale-save reload recovery, and a full app restart
using the same settings context.
The focused invoice smoke command exercises invoice-template import and reset,
custom CSS, draft preview, issuance, redesign, revision selection, validation of
both actual PDFs, reload, preview/download, fresh-process revision checks and
the payment workflow — partial payment, overpayment rejection, entry editing
and deletion, the GiroCode warning, the permanent full-payment lock and its
survival across an app restart — without the unrelated Electron flows.
The pull-request workflow runs both suites, checks the smoke-test scripts for
unused variables and syntax, and provides a virtual display for Electron. It
installs Electron before configuring its Linux sandbox helper with root
ownership and setuid permissions.
The `start`, Electron smoke test and distribution scripts build the editor and
versioned manual through npm lifecycle scripts. VS Code's debug configurations
also build these assets first.
