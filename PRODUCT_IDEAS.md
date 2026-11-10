# ClubManager — Product Ideas

This file captures the initial product direction so it can be revisited and
refined later. It is an idea document, not a finalized specification.

## App shape

- Start as a desktop app built with Electron.
- Keep the app modular: modules should be independent in their implementation
  and responsibilities.
- Allow modules to share data through clear, intentional interfaces when needed.
- Prefer a simple modular app to separate services at the beginning.

## Data and synchronization

- Synchronize all stored app data through Nextcloud files, including data from
  every module and any stored attachments or generated documents.
- Support working offline and syncing changes when Nextcloud is available again.
- Consider storing records in small, separate files instead of one large file to
  reduce the scope of conflicts. This alone does not guarantee reliable sync.
- Design for interrupted writes, simultaneous edits, deletion, and conflict
  detection and resolution without silently losing data.
- Define a versioned file format, safe writes, and backup and recovery
  procedures before implementing synchronization.

## UI

- Use a left-side icon bar, similar to the Visual Studio Code activity bar, to
  switch between modules.

## Initial modules

### Meetings

- List different meeting points.
- Allow meeting points to be added, deleted, and reordered.
- Give each meeting point a headline followed by details and a type: discussion,
  decision, or info.
- Allow descriptions to be written in a Markdown editor.
- Allow tasks to be written down for each meeting point.
- Allow one or more responsible persons to be associated with each task.
- Include an Open Tasks submodule for checking outstanding meeting tasks.
- Record attendance for each meeting, distinguishing attendees, people absent
  with an excuse, and people absent without an excuse.
- Generate a PDF for each meeting protocol (minutes) and store the protocol in
  a format to be determined.
- Use the same HTML and CSS approach as the invoice and letter modules for
  meeting protocol PDF layout and styling.

### Invoices

- Provide an invoice module for creating/writing invoices.
- Use a master-detail view: show a list of invoices and display the selected
  invoice's details alongside or in a detail pane.
- Generate a PDF invoice from the entered invoice information.
- Build the layout with HTML and style it with CSS.

### Members

- Provide a member module with a master-detail view: show a list of members and
  the selected member's details.
- Store member information such as first name, last name, address, and birthday.
- Refine additional member fields later.
- Include a Next Birthdays submodule to check members' upcoming birthdays.

### Letters

- Provide a module for writing series letters to members.
- Write letters in a Markdown editor and process the Markdown into HTML.
- Allow members to be filtered when selecting recipients for a series letter.
- Prepare for writing a letter to a single person as well.
- Use the same HTML and CSS approach as the invoice module for letter layout
  and styling.
- Access member data through a clear module interface.

## Open for later decisions

- What information a meeting point, task, responsible person, and invoice should
  contain.
- How meeting protocols and their generated PDFs are stored and managed.
- Whether people and other records are shared between modules.
- Which member filters and letter personalization fields are needed, and whether
  single-person recipients can be non-members.
- How invoices are numbered and stored, and what PDF export or printing options
  are needed.
- Whether to synchronize through the Nextcloud desktop client, WebDAV, or
  another supported approach, and how conflicts are presented and resolved.
- Data storage format, encryption, access control, and backup requirements.
- The final visual design and module icon choices.
