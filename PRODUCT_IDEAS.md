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

## UI

- [x] Use a left-side icon bar, similar to the Visual Studio Code activity bar, to
  switch between modules.
- [x] Place Settings at the bottom of the icon bar.
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
- [ ] Prepare Linux packaging.
- [x] Initial macOS builds are for testing and are not signed or notarized.
- [ ] Later, publish app releases through GitHub Releases and use them to deliver
  app updates. Decide on the update workflow, signing, release permissions, and
  user experience before implementing it.

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
- [x] Store the local completion date when a task is completed; clear it if the
  task is reopened. Show task checkboxes and completion dates in the PDF.
- [x] Include an Open Tasks submodule for checking outstanding meeting tasks.
- [x] Record attendance for each meeting, distinguishing attendees, people absent
  with an excuse, and people absent without an excuse.
- [x] Generate a meeting protocol PDF and store it in `meetings/protocols`.
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

- [ ] Provide an invoice module for creating/writing invoices.
- [ ] Use a master-detail view: show a list of invoices and display the selected
  invoice's details alongside or in a detail pane.
- [ ] Generate a PDF invoice from the entered invoice information.
- [ ] Build the layout with HTML and style it with CSS.

### Members

- [ ] Provide a member module with a master-detail view: show a list of members and
  the selected member's details.
- [ ] Store member information such as first name, last name, address, and birthday.
- [ ] Refine additional member fields later.
- [ ] Include a Next Birthdays submodule to check members' upcoming birthdays.

### Letters

- [ ] Provide a module for writing series letters to members.
- [ ] Write letters in a Markdown editor and process the Markdown into HTML.
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
- [ ] Decide which member filters and letter personalization fields are needed, and whether
  single-person recipients can be non-members.
- [ ] Decide how invoices are numbered and stored, and what PDF export or printing options
  are needed.
- [ ] Decide on encryption, access control, backups, and storage formats for
  future modules. Meeting data currently uses versioned JSON.
- [ ] Decide on the final visual design and module icon choices.
