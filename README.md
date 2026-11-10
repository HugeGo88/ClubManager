# ClubManager

An early Electron desktop app. The first version focuses on meetings; Members,
Invoices, and Letters are placeholders. See [product ideas](PRODUCT_IDEAS.md)
for the longer-term direction.

## Run

Install Node.js 22.12 or newer and npm, then:

```sh
npm install
npm start
```

In Settings (the bottom icon), choose a data folder. The app creates `meetings`,
`members`, `invoices`, and `letters` subfolders without moving existing data.
Selecting another folder opens that folder's data; it does not migrate it.

Use **New meeting** or **Sample meeting** to begin, then save. Meeting data is
stored as individual versioned JSON files. Exporting a saved meeting writes its
PDF to `meetings/protocols`, replacing the previous PDF for that meeting. Meeting
details support Markdown, and the Open Tasks view lists tasks from saved meetings.
After export, **Gespeichertes PDF öffnen** opens the last exported protocol in
the system's default PDF viewer. It does not include subsequent meeting changes
until the PDF is exported again.
Check a task there to mark it done and save the change immediately. Use Reload
tasks to refresh the list, including after an on-disk conflict.

The app warns if a meeting has changed on disk since it was opened. This is not
a synchronization system or a substitute for backups; avoid editing the same
folder with multiple app instances at the same time. Data is not encrypted.

Run the storage tests with `npm test`. With a graphical desktop available, run
the Electron smoke test with `npm run test:electron`.

The interface and generated protocol labels are German. Write new user-facing
text in German, including accessibility labels, dialogs, errors, and document
output. Reuse shared terms from `src/shared/de.js` in the UI and documents.
Existing user-entered content is not translated automatically.

## Debug

In VS Code, choose **Launch Electron main** in Run and Debug and press F5.
VS Code starts Electron and attaches the debugger automatically. Set breakpoints
in the main process, such as `src/main/main.js`; stop debugging to close the
launched app. Install dependencies first with `npm install`. To debug renderer
code, use the Electron window's Developer Tools.

Alternatively, run the **Electron: debug main process** task and select
**Attach to Electron main** to attach to that running instance. Its inspector
listens on `127.0.0.1:9231`; stop the task when finished.

## Package the app

On an Apple Silicon Mac, build a DMG containing the app with:

```sh
npm run dist:mac
```

The output is in `dist/`. This initial build is unsigned and not notarized;
macOS Gatekeeper may block it or display a warning. A public release will need
an Apple Developer ID, code signing, and notarization.

A Windows x64 NSIS installer target is prepared for a future Windows build:

```sh
npm run dist:win
```

Run this on Windows for the most reliable results. It has not yet been
validated on Windows. Windows code signing and Linux packaging are deferred.
