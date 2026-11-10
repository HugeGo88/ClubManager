const { app, dialog, shell } = require('electron');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-electron-test-'));
  process.on('exit', () => fsSync.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  await fs.mkdir(data);
  app.setPath('userData', path.join(root, 'settings'));
  await fs.mkdir(app.getPath('userData'));
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data] });
  const openedPaths = [];
  let openError = '';
  shell.openPath = async file => { openedPaths.push(file); return openError; };

  const timeout = setTimeout(() => {
    console.error('Electron smoke test timed out.');
    app.exit(1);
  }, 30000);
  app.once('browser-window-created', (event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (test) => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for UI');
          };
          const click = async selector => {
            const element = await waitFor(() => !document.body.inert && document.querySelector(selector));
            element.click();
          };
          await click('[data-view="settings"]');
          await click('[data-action="choose-folder"]');
          await waitFor(() => document.querySelector('.path')?.textContent.includes('data'));
          await click('[data-view="meetings"]');
          await click('[data-action="sample"]');
          await waitFor(() => document.querySelector('[data-field="title"]'));
          const absentBeforeExport = !document.querySelector('[data-action="open-protocol"]');
          const language = document.documentElement.lang;
          const navigation = [...document.querySelectorAll('[data-view]')].map(button => button.getAttribute('aria-label'));
          const attendanceOptions = [...document.querySelector('[data-person="0"][data-field="status"]').options].map(option => option.textContent);
          const typeOptions = [...document.querySelector('[data-point="0"][data-field="type"]').options].map(option => option.textContent);
          const editor = document.querySelector('[data-markdown-editor="0"] .cm-content');
          await waitFor(() => editor.querySelector('.markdown-strong'));
          const previewText = editor.textContent;
          const bold = editor.querySelector('.markdown-strong');
          editor.focus();
          const selection = window.getSelection();
          selection.setPosition(bold.firstChild, 2);
          document.dispatchEvent(new Event('selectionchange'));
          await waitFor(() => editor.textContent.includes('**Veranstaltungsplan**'));
          const rawVisible = editor.textContent.includes('**Veranstaltungsplan**');
          document.querySelector('[data-field="title"]').focus();
          await waitFor(() => !editor.textContent.includes('**Veranstaltungsplan**'));
          editor.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, '   # Planung\\n**Fett** und *kursiv* [Web](https://example.com)\\n[x](https://a "mehr\\nZeilen")\\n\\n- Apfel\\n  - Birne\\n\\n1. Eins\\n2. Zwei\\n\\n- [ ] Offen\\n- [x] Fertig');
          await waitFor(() => document.querySelector('.status').textContent === 'Ungespeicherte Änderungen');
          document.querySelector('[data-field="title"]').focus();
          await waitFor(() => editor.querySelector('.markdown-strong') && editor.querySelector('.markdown-emphasis') && editor.querySelector('.markdown-heading-1'));
          const editedPreview = editor.textContent;
          const renderedLink = !!editor.querySelector('.markdown-link') && !editedPreview.includes('https://example.com');
          await waitFor(() => editor.querySelectorAll('.markdown-task').length === 2);
          const bullets = editor.querySelectorAll('.markdown-bullet').length;
          const numbers = [...editor.querySelectorAll('.markdown-list-number')].map(element => element.textContent);
          const tasksBefore = [...editor.querySelectorAll('.markdown-task')].map(element => element.checked);
          editor.querySelector('.markdown-task').click();
          await waitFor(() => editor.querySelector('.markdown-task')?.checked);
          await click('[data-action="move-down"][data-index="0"]');
          const persistedChecks = [...document.querySelectorAll('[data-markdown-editor="1"] .markdown-task')].map(element => element.checked);
          await click('[data-action="save"]');
          await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('Sitzung gespeichert'));
          await click('[data-action="export"]');
          const notice = await waitFor(() => {
            const text = document.querySelector('[role="status"]')?.textContent;
            return text?.includes('PDF gespeichert') && text;
          });
          await waitFor(() => document.querySelector('[data-action="open-protocol"]'));
          await click('[data-action="open-protocol"]');
          await waitFor(() => !document.body.inert);
          await click('[data-view="tasks"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Offene Aufgaben');
          return { notice, tasks: document.querySelector('main').textContent, language, navigation, attendanceOptions, typeOptions, absentBeforeExport, previewText, rawVisible, editedPreview, renderedLink, bullets, numbers, tasksBefore, persistedChecks };
        })()`);
        assert.equal(result.language, 'de');
        assert.ok(!result.previewText.includes('**'));
        assert.ok(result.rawVisible);
        assert.ok(!result.editedPreview.includes('**'));
        assert.match(result.editedPreview, /Fett/);
        assert.ok(result.renderedLink);
        assert.equal(result.bullets, 2);
        assert.deepEqual(result.numbers, ['1.', '2.']);
        assert.deepEqual(result.tasksBefore, [false, true]);
        assert.deepEqual(result.persistedChecks, [true, true]);
        assert.ok(result.absentBeforeExport);
        assert.deepEqual(result.navigation, ['Sitzungen', 'Offene Aufgaben', 'Mitglieder', 'Rechnungen', 'Briefe', 'Einstellungen']);
        assert.deepEqual(result.attendanceOptions, ['Anwesend', 'Entschuldigt abwesend', 'Unentschuldigt abwesend']);
        assert.deepEqual(result.typeOptions, ['Diskussion', 'Entscheidung', 'Information']);
        assert.match(result.tasks, /Veranstaltungsort kontaktieren/);
        const meetingsDir = path.join(data, 'meetings');
        const files = await fs.readdir(meetingsDir);
        const jsonFile = files.find(file => file.endsWith('.json'));
        assert.ok(jsonFile);
        const saved = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(saved.meeting.points[0].headline, 'Budget');
        assert.equal(saved.meeting.points[1].headline, 'Kommende Veranstaltung');
        assert.equal(saved.meeting.points[1].details, '   # Planung\n**Fett** und *kursiv* [Web](https://example.com)\n[x](https://a "mehr\nZeilen")\n\n- Apfel\n  - Birne\n\n1. Eins\n2. Zwei\n\n- [x] Offen\n- [x] Fertig');
        const pdf = await fs.readFile(path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`));
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.deepEqual(openedPaths, [path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`)]);
        saved.meeting.points[0].tasks.push({ description: 'Budget prüfen', responsible: 'Zoe Beispiel', done: false });
        await fs.writeFile(path.join(meetingsDir, jsonFile), JSON.stringify(saved, null, 2) + '\n');
        const table = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (test) => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for table');
          };
          const rows = () => [...document.querySelectorAll('.tasks-table tbody tr')].map(row => row.cells[1].textContent);
          const filter = (name, value) => {
            const input = document.querySelector('[data-task-filter="' + name + '"]');
            input.focus();
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return document.activeElement === input;
          };
          document.querySelector('[data-action="refresh-tasks"]').click();
          await waitFor(() => rows().length === 2);
          document.querySelector('[data-sort="description"]').click();
          await waitFor(() => document.querySelector('[aria-sort="ascending"]'));
          const ascending = rows();
          document.querySelector('[data-sort="description"]').click();
          await waitFor(() => document.querySelector('[aria-sort="descending"]'));
          const descending = rows();
          const keptFocus = filter('search', 'BUDGET') && filter('responsible', 'zoe');
          const filtered = rows();
          filter('responsible', 'Niemand');
          const noMatch = document.querySelector('#task-results').textContent.includes('Keine Aufgaben entsprechen den Filtern.');
          document.querySelector('[data-action="clear-task-filters"]').click();
          await waitFor(() => rows().length === 2);
          filter('search', 'budget');
          document.querySelector('[data-complete-task]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Aufgabe als erledigt markiert.');
          const remainingFiltered = document.querySelector('#task-results').textContent;
          document.querySelector('[data-action="clear-task-filters"]').click();
          await waitFor(() => rows().length === 1);
          return { ascending, descending, keptFocus, filtered, noMatch, remainingFiltered, remaining: rows() };
        })()`);
        assert.deepEqual(table.ascending, ['Budget prüfen', 'Veranstaltungsort kontaktieren']);
        assert.deepEqual(table.descending, ['Veranstaltungsort kontaktieren', 'Budget prüfen']);
        assert.ok(table.keptFocus);
        assert.deepEqual(table.filtered, ['Budget prüfen']);
        assert.ok(table.noMatch);
        assert.match(table.remainingFiltered, /Keine Aufgaben entsprechen den Filtern/);
        assert.deepEqual(table.remaining, ['Veranstaltungsort kontaktieren']);
        const afterTable = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(afterTable.meeting.points[0].tasks[0].done, true);
        assert.equal(afterTable.meeting.points[1].tasks[0].done, false);
        afterTable.meeting.points[1].tasks[0].responsible = 'Updated externally';
        await fs.writeFile(path.join(meetingsDir, jsonFile), JSON.stringify(afterTable, null, 2) + '\n');
        const completion = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (test) => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for completion UI');
          };
          document.querySelector('[data-complete-task]').click();
          const conflict = await waitFor(() => {
            const notice = document.querySelector('.notice.error')?.textContent;
            return notice?.includes('auf dem Datenträger geändert') && notice;
          });
          const stillOpen = !!document.querySelector('[data-complete-task]:not(:checked)');
          document.querySelector('[data-action="refresh-tasks"]').click();
          await waitFor(() => document.querySelector('.tasks-table tbody')?.textContent.includes('Updated externally'));
          document.querySelector('[data-complete-task]').click();
          await waitFor(() => document.querySelector('[role="status"]')?.textContent === 'Aufgabe als erledigt markiert.');
          const empty = document.querySelector('main').textContent.includes('Keine offenen Aufgaben.');
          document.querySelector('[data-view="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="select"]'));
          document.querySelector('[data-action="select"]').click();
          await waitFor(() => document.querySelector('[data-point="1"][data-field="done"]'));
          return { conflict, stillOpen, empty, checked: document.querySelector('[data-point="1"][data-field="done"]').checked,
            openAvailable: !!document.querySelector('[data-action="open-protocol"]') };
        })()`);
        assert.match(completion.conflict, /auf dem Datenträger geändert/);
        assert.doesNotMatch(completion.conflict, /Error invoking remote method/);
        assert.ok(completion.stillOpen);
        assert.ok(completion.empty);
        assert.ok(completion.checked);
        assert.ok(completion.openAvailable);
        const completed = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(completed.meeting.points[1].tasks[0].done, true);
        assert.equal(completed.meeting.points[1].tasks[0].responsible, 'Updated externally');
        openError = 'Testfehler';
        const openFailure = await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="open-protocol"]').click();
          for (let i = 0; i < 200; i++) {
            const text = document.querySelector('.notice.error')?.textContent;
            if (text) return text;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Timed out waiting for PDF open error');
        })()`);
        assert.match(openFailure, /konnte nicht geöffnet werden: Testfehler/);
        await fs.unlink(path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`));
        const missing = await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="open-protocol"]').click();
          for (let i = 0; i < 200; i++) {
            const text = document.querySelector('.notice.error')?.textContent;
            if (text?.includes('nicht gefunden')) return text;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Timed out waiting for missing PDF error');
        })()`);
        assert.match(missing, /nicht gefunden/);
        for (const module of ['members', 'letters', 'invoices']) {
          assert.ok((await fs.stat(path.join(data, module))).isDirectory());
        }
        console.log('Electron smoke test passed: task table filtering, sorting, completion, conflict recovery, and PDF export.');
        clearTimeout(timeout);
        window.destroy();
        app.exit(0);
      } catch (error) {
        console.error(error);
        clearTimeout(timeout);
        window.destroy();
        app.exit(1);
      }
    });
  });
  require('../src/main/main');
}

main().catch(error => {
  console.error(error);
  app.exit(1);
});
