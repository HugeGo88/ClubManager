# ClubManager — Product Ideas

This file captures the initial product direction so it can be revisited and
refined later. It is an idea document, not a finalized specification.
Checked items describe functionality that is already implemented; unchecked
items are still open, partially implemented, or ongoing design goals.

## App shape

- [x] Start as a desktop app built with Electron.
- [ ] Keep the app modular: modules should be independent in their implementation
  and responsibilities.
- [ ] Allow modules to share data through clear, intentional interfaces when needed.
  The remaining modules are placeholders; a cross-module interface is still to
  be designed.
- [x] Prefer a simple modular app to separate services at the beginning.

## Data storage

- [x] For now, store app data locally in a user-selected folder; Nextcloud
  synchronization is not part of the current scope.
- [x] Provide a Settings page at the bottom of the left sidebar where the storage
  folder can be selected.
- [x] Create a separate subfolder for each module inside the selected folder.
- [x] Store meetings in separate versioned JSON files with safe writes and
  revision conflict detection.

## Multiple data folders

- [x] Register multiple local data folders and switch between them from the app
  header, remembering the active folder.
- [x] Keep meeting and letter PDF templates, shared PDF CSS, and letter
  signatures with their data folder; use packaged defaults independently for
  missing custom document files.
- [x] Store customizable display names with their data folders so they survive
  moves, backups, and re-registration.
- [ ] Remove folders from the app's list without deleting their files.
- [x] Keep module selection with each data folder; keep the sidebar preference
  app-wide. Existing folders inherit the legacy selection once.
- [x] Protect drafts when module-setting changes hide an editor (#16).
- [x] Refresh the folder selection on open, switch and Settings entry; protect
  drafts and reject stale edits until the user reloads (#17).
- [x] Migrate existing global templates, CSS, and signatures into the active
  folder (or the first folder added), preserving existing destination files and
  reporting conflicts.

## UI

- [x] Use a left-side icon bar, similar to the Visual Studio Code activity bar, to
  switch between modules, with a persistent toggle for showing or hiding labels.
- [x] Place Settings at the bottom of the icon bar.
- [x] Provide a settings tab for each module and allow modules to be enabled or
  disabled; only Meetings is enabled by default and disabled modules are hidden
  from the sidebar.
- [x] The interface and generated document labels are in German. New UI elements
  should also use German; shared terminology must stay consistent.
- [x] Refer to meeting agenda items as TOPs (Tagesordnungspunkte).

## First version

- [x] Build a working Meetings module first, with placeholders for the other modules.
- [ ] Include clearly marked sample data in the app. The example-meeting button
  was removed; the README screenshots use fictional data.
- [x] Store data in the selected local folder.

## Distribution

- [x] Package the macOS app for Apple Silicon first.
- [x] Prepare an installer build configuration for Windows.
- [x] Prepare an Ubuntu x64 `.deb` installer in the release workflow.
- [ ] Verify the Ubuntu package and automatic update process on Ubuntu.
- [x] Initial macOS builds are for testing and are not signed or notarized.
- [x] Add a manually started GitHub Releases workflow and startup update checks,
  with user confirmation before installation.
- [ ] Configure Apple Developer credentials and verify the signed macOS release
  and updates on a real Mac.
- [ ] Verify the Windows release and updates on Windows; configure Windows code
  signing for distribution.

## Initial modules

### Meetings

- [x] List different meeting points.
- [x] Allow meeting points to be added, deleted, and reordered.
- [x] Give each meeting point a headline followed by details and a type: discussion,
  decision, or info.
- [x] Allow descriptions to be written in a Markdown editor.
- [x] Allow tasks to be written down for discussion and information TOPs.
  Decision TOPs use voting results instead; existing legacy tasks are retained.
- [x] Allow one or more responsible persons to be associated with each task.
- [x] Allow an optional deadline on each task and highlight overdue open tasks.
- [x] Show an overdue task badge and a separate overdue table, with an option
  to include and reopen completed tasks in the task overview.
- [x] Store the local completion date when a task is completed; clear it if the
  task is reopened. Show task checkboxes and completion dates in the PDF.
- [x] Protect individual protocols from accidental editing, with confirmation
  before unlocking and task completion still available.
- [x] Show a lock icon in the saved-meetings list for protocols marked read-only.
- [x] Include an Open Tasks submodule for checking outstanding meeting tasks and
  expanding their associated TOP details.
- [x] Show current task totals and an estimated open-task trend in a Statistics
  subview, with explicit limitations for missing dates and historical changes.
- [x] List all TOPs across saved protocols with full-text search and filters for
  TOP type and protocol.
- [x] Record attendance for each meeting, distinguishing attendees, people absent
  with an excuse, and people absent without an excuse.
- [x] Record an optional meeting chair and recorder and include them in the protocol.
- [x] Generate a meeting protocol PDF and store it in `meetings/protocols`.
- [x] Delete a saved meeting and its exported PDF from the editor.
- [x] Build the meeting protocol PDF using HTML and CSS, with an optional custom
  stylesheet.
- [ ] Use a consistent HTML and CSS approach across meeting protocols, invoices,
  and letters once the other document modules are implemented.
- [x] Allow an optional responsible person for each TOP.
- [x] Record decision outcomes and optional vote counts, and list decisions in a
  searchable submodule.
- [x] List open tasks grouped by responsible person at the end of the PDF, with
  an option to include open tasks from earlier meetings.

### Invoices

- [x] Subscribe to one ICS calendar URL for the active data folder and show
  ordinary timed events in a read-only month view under Rechnungen (#21).
- [x] Open read-only event details and show remaining events from crowded days
  in an overflow view under Rechnungen (#22).
- [x] Share the last successful calendar fetch through the data folder, with its
  fetch time, source-specific offline fallback and stale warning (#23).
- [x] Show timed, all-day, multi-day and recurring ICS events with timezone
  conversion, moved occurrences and cancellations under Rechnungen (#24).
- [x] Display multi-day calendar events as continuous bars that wrap by week,
  with crowded-day overflow.
- [x] Retain previously observed standalone ICS events with UIDs per data folder
  and source, subject to expiry and explicit cancellation (#34).
- [x] Retain previously observed standalone ICS events without UIDs by content,
  with possible separate versions after changes (#35).
- [x] Retain recurring calendar occurrences, including shortened series and
  explicit exclusions and cancellations (#33, #36).
- [x] Provide an invoice module for creating and managing invoice drafts (#40).
- [x] Use a master-detail view: show a list of invoices and display the selected
  invoice's details alongside or in a detail pane (#40).
- [x] Enter invoice unit prices in euros and show rounded position totals and
  the overall amount in the draft editor and HTML preview.
- [x] Issue invoices with a per-folder prefix and annual sequence, freezing the
  issuer and invoice snapshot and preventing edits after issuance (#41).
- [x] Generate a local ZUGFeRD PDF with EN-16931 CII XML and an EPC GiroCode,
  store it with an integrity hash, and provide in-app preview and download (#41).
- [x] Build the issued invoice layout with HTML and shared PDF CSS.
- [x] Import and reset a folder-local HTML invoice template with documented
  placeholders, safe generated positions and GiroCode blocks, and preview drafts
  with that template.
- [x] Deliberately redesign issued invoices without changing their number or
  factual/XML contents; preserve selectable, integrity-checked PDF revisions
  across app restarts.

### Members

- [ ] Provide a member module with a master-detail view: show a list of members and
  the selected member's details.
- [ ] Store member information such as first name, last name, address, and birthday.
- [ ] Refine additional member fields later.
- [ ] Include a Next Birthdays submodule to check members' upcoming birthdays.

### Letters

- [ ] Provide a module for writing series letters to members.
- [x] Save individual letters, write them in a Markdown editor, and export PDFs
  with an optional address, custom template and linked signatures.
- [x] Preview the last exported letter PDF in a resizable in-app pane.
- [x] Keep the PDF preview open while switching saved letters or meetings, with
  a message when the selected item has no readable export.
- [x] Define folder-wide text values for custom placeholders in letter templates
  and Markdown letter content.
- [ ] Allow members to be filtered when selecting recipients for a series letter.
- [ ] Prepare for writing a letter to a single person as well.
- [ ] Use the same HTML and CSS approach as the invoice module for letter layout
  and styling.
- [ ] Access member data through a clear module interface.

## Open for later decisions

- [ ] Refine the information meeting points, tasks and responsible people
  should contain; decide what information invoices should contain.
- [ ] Decide whether the current meeting JSON and generated PDF storage approach
  needs further protocol management features.
- [ ] Decide whether people and other records are shared between modules.
- [ ] Decide which member-derived personalization fields series letters need, and
  whether single-person recipients can be non-members.
- [ ] Add workflows for correcting or cancelling issued invoices and handling
  VAT cases beyond the current outside-scope assumption.
- [ ] Decide on encryption, access control, backups, and storage formats for
  future modules. Meeting data currently uses versioned JSON.
- [ ] Decide on the final visual design and module icon choices.
