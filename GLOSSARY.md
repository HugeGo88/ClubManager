# ClubManager

Shared language for ClubManager's club data and generated documents.

## Data and documents

**Data folder**:
A local collection of records and document customizations for one club or context.
_Avoid_: ClubManagerData set, storage folder

**Active data folder**:
The data folder currently in use by ClubManager.
_Avoid_: current folder

**Registered data folder**:
A data folder available to choose in ClubManager.
_Avoid_: saved folder

**Data folder display name**:
The editable name ClubManager shows for a data folder, independent of the directory's name.
_Avoid_: directory name

**Module selection**:
The explicit shared choice of modules visible for a data folder, stored with that folder.
_Avoid_: personal module preference

**Document customization**:
A user-provided HTML template or stylesheet for generated club documents, distinct from the app's interface.
_Avoid_: app stylesheet

**Custom letter placeholder**:
A named, folder-wide text value that a letter HTML template or Markdown body can insert; it is shared by all letters in that data folder, not a per-letter or recipient field.
_Avoid_: custom field

**Signature library**:
The named signatures available for use in letters for a data folder.
_Avoid_: global signatures

**PDF preview**:
A read-only view of an exported document PDF, not a live rendering of unsaved edits.

## Invoices and correspondence

**Invoice draft**:
An editable invoice that has not yet been issued.

**Issued invoice**:
An invoice whose contents are fixed, regardless of whether it has been emailed or paid.

**Paid invoice**:
An issued invoice fully covered by its recorded payments, whose payment records are no longer editable.
_Avoid_: emailed invoice

**Invoice payment**:
A dated amount manually recorded against an invoice; several payments may contribute to settling one invoice.
_Avoid_: paid toggle

**Outstanding invoice balance**:
The amount of an issued invoice not yet covered by its recorded payments.
_Avoid_: invoice total

**Invoice GiroCode**:
An EPC payment QR code carrying the issued invoice's original total and bank-transfer details, not confirmation of payment or an updated outstanding balance.

**Invoice email send**:
An attempt to email an issued invoice to its recipient. Successful sending means acceptance by the outgoing mail server, not confirmed delivery or reading.
_Avoid_: delivery confirmation

**Invoice template**:
The customizable layout of an invoice document, distinct from the email carrying it.
_Avoid_: invoice email template

**Invoice PDF revision**:
A PDF representation of an issued invoice, with the same invoice number and factual contents as its other revisions but potentially a different layout.
_Avoid_: replacement invoice

**Email template**:
The customizable subject and message of outgoing correspondence, distinct from an attached invoice document.

**Data folder email configuration**:
The sender and outgoing email account shared by modules within one data folder, not by every registered data folder.
_Avoid_: app-wide email account

## Calendar

**Retained calendar event**:
A previously observed calendar event that remains visible after it disappears from its source.

## Sitzungen

**Sitzungsleitung**:
Die Person, die eine Sitzung leitet; sie kann zugleich die Protokollführung übernehmen.

**Protokoll-Schreibschutz**:
Status eines Sitzungsprotokolls, in dem Protokollinhalte nicht bearbeitet werden können; Aufgaben bleiben davon ausgenommen.
_Avoid_: Sitzung gesperrt
