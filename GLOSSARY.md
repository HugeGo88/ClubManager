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

**Document customization**:
A user-provided HTML template or stylesheet for generated meeting protocols and letters, distinct from the app's interface.
_Avoid_: app stylesheet

**Signature library**:
The named signatures available for use in letters for a data folder.
_Avoid_: global signatures

## Sitzungen

**Sitzungsleitung**:
Die Person, die eine Sitzung leitet; sie kann zugleich die Protokollführung übernehmen.

**Protokoll-Schreibschutz**:
Status eines Sitzungsprotokolls, in dem Protokollinhalte nicht bearbeitet werden können; Aufgaben bleiben davon ausgenommen.
_Avoid_: Sitzung gesperrt
