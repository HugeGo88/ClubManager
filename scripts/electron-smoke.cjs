const { app, BrowserWindow, dialog, shell } = require('electron');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-electron-test-'));
  process.on('exit', () => fsSync.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  const cssFile = path.join(root, 'custom.css');
  await fs.writeFile(cssFile, 'body { color: rgb(12, 34, 56); }');
  await fs.mkdir(data);
  app.setPath('userData', path.join(root, 'settings'));
  await fs.mkdir(app.getPath('userData'));
  let cancelCssDialog = false;
  dialog.showOpenDialog = async (window, options) => options.properties.includes('openFile')
    ? (cancelCssDialog ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [cssFile] })
    : { canceled: false, filePaths: [data] };
  const pdfColors = [];
  const pdfPointHeadings = [];
  app.on('browser-window-created', (event, window) => {
    if (window.isVisible()) return;
    const printToPDF = window.webContents.printToPDF.bind(window.webContents);
    window.webContents.printToPDF = async options => {
      pdfColors.push(await window.webContents.executeJavaScript('getComputedStyle(document.body).color'));
      pdfPointHeadings.push(await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.point-heading h3'), element => element.textContent)`));
      return printToPDF(options);
    };
  });
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
        await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-view="settings"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('[data-action="choose-protocol-css"]')) break;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (!document.querySelector('[data-protocol-css]').textContent.includes('Standardlayout')) throw new Error('Missing default CSS');
          document.querySelector('[data-action="choose-protocol-css"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('[data-action="reset-protocol-css"]')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('CSS selection timed out');
        })()`);
        const settingsFile = path.join(app.getPath('userData'), 'settings.json');
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { folder: null, protocolCss: cssFile });
        cancelCssDialog = true;
        await window.webContents.executeJavaScript(`(async () => {
          const button = document.querySelector('[data-action="choose-protocol-css"]');
          button.click();
          for (let i = 0; i < 200; i++) {
            if (!button.isConnected) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('CSS dialog cancellation timed out');
        })()`);
        assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).protocolCss, cssFile);
        cancelCssDialog = false;
        await fs.writeFile(cssFile, 'body { color: rgb(65, 43, 21); }');
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
          await waitFor(() => document.querySelector('.list'));
          if (document.querySelector('[data-action="sample"]') || document.querySelector('.list').textContent.includes('Beispielsitzung')) {
            throw new Error('Sample meeting button must not be present');
          }
          await click('[data-action="new"]');
          const addButton = await waitFor(() => document.querySelector('[data-action="add-point"]'));
          const emptyMessage = [...document.querySelectorAll('main p')].find(p => p.textContent === 'Noch keine TOPs vorhanden.');
          if (!emptyMessage || !(emptyMessage.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            throw new Error('TOP button should follow the empty list');
          }
          await click('[data-action="add-point"]');
          await waitFor(() => document.querySelector('[data-point="0"][data-field="headline"]'));
          await click('[data-action="add-point"]');
          await waitFor(() => document.querySelector('[data-point="1"][data-field="headline"]'));
          const pointSections = [...document.querySelectorAll('main section.card')];
          const lastAddButton = document.querySelector('[data-action="add-point"]');
          if (pointSections.length !== 2 || !(pointSections[1].compareDocumentPosition(lastAddButton) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            throw new Error('TOP button should follow all added points');
          }
          const setInput = (selector, value) => {
            const element = document.querySelector(selector);
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
          };
          setInput('[data-field="title"]', 'Beispiel: Vorstandssitzung');
          setInput('[data-field="date"]', clubDates.localDate());
          await click('[data-action="add-person"]');
          await waitFor(() => document.querySelector('[data-person="0"][data-field="name"]'));
          setInput('[data-person="0"][data-field="name"]', 'Alex Beispiel');
          await click('[data-action="add-person"]');
          await waitFor(() => document.querySelector('[data-person="1"][data-field="name"]'));
          setInput('[data-person="1"][data-field="name"]', 'Sam Beispiel');
          setInput('[data-person="1"][data-field="status"]', 'excused');
          setInput('[data-point="0"][data-field="headline"]', 'Kommende Veranstaltung');
          setInput('[data-point="0"][data-field="responsible"]', 'TOP Leitung & Team');
          setInput('[data-point="1"][data-field="headline"]', 'Budget');
          setInput('[data-point="1"][data-field="type"]', 'decision');
          const initialEditor = document.querySelector('[data-markdown-editor="0"] .cm-content');
          initialEditor.focus();
          document.execCommand('insertText', false, 'Den **Veranstaltungsplan** und den Veranstaltungsort besprechen.');
          await click('[data-action="add-task"][data-index="0"]');
          await waitFor(() => document.querySelector('[data-point="0"][data-task="0"][data-field="description"]'));
          setInput('[data-point="0"][data-task="0"][data-field="description"]', 'Veranstaltungsort kontaktieren');
          setInput('[data-point="0"][data-task="0"][data-field="responsible"]', 'Alex Beispiel');
          const absentBeforeExport = !document.querySelector('[data-action="open-protocol"]');
          const language = document.documentElement.lang;
          const navigation = [...document.querySelectorAll('[data-view]')].map(button => button.getAttribute('aria-label'));
          const attendanceOptions = [...document.querySelector('[data-person="0"][data-field="status"]').options].map(option => option.textContent);
          const typeOptions = [...document.querySelector('[data-point="0"][data-field="type"]').options].map(option => option.textContent);
          const editor = document.querySelector('[data-markdown-editor="0"] .cm-content');
          await waitFor(() => editor.querySelector('.markdown-strong'));
          const markdownToolbar = document.querySelector('[data-markdown-editor="0"] .markdown-toolbar');
          const formats = [
            ['Fett', '**Wort**', '.markdown-strong'],
            ['Kursiv', '*Wort*', '.markdown-emphasis'],
            ['Unterstrichen', '<u>Wort</u>', '.markdown-underline'],
            ['Durchgestrichen', '~~Wort~~', '.markdown-strike']
          ];
          for (const [label, raw, preview] of formats) {
            editor.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, 'Wort');
            document.execCommand('selectAll');
            await new Promise(resolve => setTimeout(resolve, 50));
            markdownToolbar.querySelector('[aria-label="' + label + '"]').click();
            if (editor.textContent !== raw) throw new Error(label + ': expected ' + raw + ', got ' + editor.textContent);
            document.querySelector('[data-field="title"]').focus();
            await waitFor(() => editor.querySelector(preview) && editor.textContent === 'Wort');
            editor.focus();
            markdownToolbar.querySelector('[aria-label="' + label + '"]').click();
            await waitFor(() => editor.textContent === 'Wort');
            document.execCommand('selectAll');
            document.execCommand('delete');
            await new Promise(resolve => setTimeout(resolve, 50));
            markdownToolbar.querySelector('[aria-label="' + label + '"]').focus();
            markdownToolbar.querySelector('[aria-label="' + label + '"]').click();
            document.execCommand('insertText', false, 'Wort');
            await waitFor(() => editor.textContent === raw);
          }
          editor.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, 'Wort');
          document.execCommand('selectAll');
          await new Promise(resolve => setTimeout(resolve, 50));
          markdownToolbar.querySelector('[aria-label="Fett"]').click();
          markdownToolbar.querySelector('[aria-label="Kursiv"]').click();
          await waitFor(() => editor.textContent === '***Wort***');
          markdownToolbar.querySelector('[aria-label="Kursiv"]').click();
          await waitFor(() => editor.textContent === '**Wort**');
          editor.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, 'Den **Veranstaltungsplan** und den Veranstaltungsort besprechen.');
          document.querySelector('[data-field="title"]').focus();
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
          document.execCommand('insertText', false, '   # Planung\\n**Fett** und *kursiv* [Web](https://example.com)\\n<u>Unterstrichen</u> und ~~Durchgestrichen~~\\n[x](https://a "mehr\\nZeilen")\\n\\n- Apfel\\n  - Birne\\n\\n1. Eins\\n2. Zwei\\n\\n- [ ] Offen\\n- [x] Fertig');
          await waitFor(() => document.querySelector('.status').textContent === 'Ungespeicherte Änderungen');
          document.querySelector('[data-field="title"]').focus();
          await waitFor(() => editor.querySelector('.markdown-strong') && editor.querySelector('.markdown-emphasis') && editor.querySelector('.markdown-heading-1'));
          const editedPreview = editor.textContent;
          if (!editor.querySelector('.markdown-underline') || !editor.querySelector('.markdown-strike')) {
            throw new Error('Underline and strikethrough must be visible in the preview');
          }
          const renderedLink = !!editor.querySelector('.markdown-link') && !editedPreview.includes('https://example.com');
          await waitFor(() => editor.querySelectorAll('.markdown-task').length === 2);
          const bullets = editor.querySelectorAll('.markdown-bullet').length;
          const numbers = [...editor.querySelectorAll('.markdown-list-number')].map(element => element.textContent);
          const tasksBefore = [...editor.querySelectorAll('.markdown-task')].map(element => element.checked);
          editor.querySelector('.markdown-task').click();
          await waitFor(() => editor.querySelector('.markdown-task')?.checked);
          const content = document.querySelector('.content');
          const dueInput = document.querySelector('[data-point="0"][data-task="0"][data-field="dueDate"]');
          dueInput.value = '2000-01-01';
          dueInput.dispatchEvent(new Event('input', { bubbles: true }));
          const toolbar = document.querySelector('.meeting-toolbar');
          const topBefore = toolbar.getBoundingClientRect().top;
          content.scrollTop = content.scrollHeight;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const toolbarTop = toolbar.getBoundingClientRect().top;
          const containerTop = content.getBoundingClientRect().top;
          const scrolled = content.scrollTop;
          const firstSaveRect = document.querySelector('[data-action="save"]').getBoundingClientRect();
          const stickyVisible = firstSaveRect.top >= containerTop && firstSaveRect.bottom <= content.getBoundingClientRect().bottom;
          editor.focus({ preventScroll: true });
          editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
          await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('Sitzung gespeichert'));
          const savedScroll = document.querySelector('.content').scrollTop;
          await click('[data-action="move-down"][data-index="0"]');
          const persistedChecks = [...document.querySelectorAll('[data-markdown-editor="1"] .markdown-task')].map(element => element.checked);
          const title = document.querySelector('[data-field="title"]');
          title.focus();
          title.value = 'Beispiel: Vorstandssitzung aktualisiert';
          title.dispatchEvent(new Event('input', { bubbles: true }));
          title.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
          await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('Sitzung gespeichert'));
          await click('[data-action="export"]');
          const notice = await waitFor(() => {
            const text = document.querySelector('[role="status"]')?.textContent;
            return text?.includes('PDF gespeichert') && text;
          });
          await waitFor(() => document.querySelector('[data-action="open-protocol"]'));
          const afterExportContent = document.querySelector('.content');
          afterExportContent.scrollTop = afterExportContent.scrollHeight;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const toolbarRect = document.querySelector('.meeting-toolbar').getBoundingClientRect();
          const actionRects = [...document.querySelectorAll('.meeting-actions button')].map(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
          const noOverlap = actionRects.every((rect, index) => actionRects.slice(index + 1).every(other =>
            rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top));
          const afterExportVisible = actionRects.every(rect => rect.left >= toolbarRect.left && rect.right <= toolbarRect.right &&
            rect.top >= afterExportContent.getBoundingClientRect().top && rect.bottom <= afterExportContent.getBoundingClientRect().bottom);
          await click('[data-action="open-protocol"]');
          await waitFor(() => !document.body.inert);
          await click('[data-view="tasks"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Offene Aufgaben');
          return { notice, tasks: document.querySelector('main').textContent, overdue: document.querySelectorAll('.overdue').length, language, navigation, attendanceOptions, typeOptions, absentBeforeExport, previewText, rawVisible, editedPreview, renderedLink, bullets, numbers, tasksBefore, persistedChecks, topBefore, toolbarTop, containerTop, scrolled, stickyVisible, savedScroll, afterExportVisible, noOverlap };
        })()`);
        assert.equal(result.language, 'de');
        assert.ok(result.scrolled > 100, 'Meeting must scroll for the sticky toolbar test');
        assert.ok(Math.abs(result.toolbarTop - result.containerTop) <= 1, 'Toolbar must stick to the top');
        assert.ok(result.stickyVisible);
        assert.ok(Math.abs(result.savedScroll - result.scrolled) <= 1, 'Saving must preserve scroll position');
        assert.ok(result.afterExportVisible);
        assert.ok(result.noOverlap);
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
        assert.match(result.tasks, /01\.01\.2000/);
        assert.match(result.tasks, /Überfällig/);
        assert.equal(result.overdue, 1);
        const meetingsDir = path.join(data, 'meetings');
        const files = await fs.readdir(meetingsDir);
        const jsonFile = files.find(file => file.endsWith('.json'));
        assert.ok(jsonFile);
        const saved = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(saved.meeting.title, 'Beispiel: Vorstandssitzung aktualisiert');
        assert.equal(saved.meeting.points[0].headline, 'Budget');
        assert.equal(saved.meeting.points[1].headline, 'Kommende Veranstaltung');
        assert.equal(saved.meeting.points[1].responsible, 'TOP Leitung & Team');
        assert.equal(saved.meeting.points[0].responsible, undefined);
        assert.equal(saved.meeting.points[1].tasks[0].responsible, 'Alex Beispiel');
        assert.equal(saved.meeting.points[1].tasks[0].dueDate, '2000-01-01');
        assert.equal(saved.meeting.points[1].details, '   # Planung\n**Fett** und *kursiv* [Web](https://example.com)\n<u>Unterstrichen</u> und ~~Durchgestrichen~~\n[x](https://a "mehr\nZeilen")\n\n- Apfel\n  - Birne\n\n1. Eins\n2. Zwei\n\n- [x] Offen\n- [x] Fertig');
        const pdf = await fs.readFile(path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`));
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.deepEqual(pdfColors, ['rgb(65, 43, 21)']);
        assert.deepEqual(pdfPointHeadings, [['1. Budget', '2. Kommende Veranstaltung (TOP Leitung & Team)']]);
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { folder: data, protocolCss: cssFile });
        assert.deepEqual(openedPaths, [path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`)]);
        const now = new Date();
        const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        saved.meeting.points[0].tasks.push({ description: 'Budget prüfen', responsible: 'Zoe Beispiel', done: false, dueDate: today });
        await fs.writeFile(path.join(meetingsDir, jsonFile), JSON.stringify(saved, null, 2) + '\n');
        window.setSize(850, 700);
        await new Promise(resolve => setTimeout(resolve, 200));
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
          const viewport = document.querySelector('.table-scroll');
          const taskTable = document.querySelector('.tasks-table');
          const columnWidths = [...taskTable.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width);
          const horizontalOverflow = viewport.scrollWidth > viewport.clientWidth;
          viewport.scrollLeft = viewport.scrollWidth;
          const scrollAtEnd = viewport.scrollLeft;
          document.querySelector('[data-sort="dueDate"]').click();
          await waitFor(() => document.querySelector('[data-sort="dueDate"]').closest('th').getAttribute('aria-sort') === 'ascending');
          const scrollAfterSort = document.querySelector('.table-scroll').scrollLeft;
          filter('search', 'Budget');
          const scrollAfterFilter = document.querySelector('.table-scroll').scrollLeft;
          filter('search', '');
          const overdueRows = [...document.querySelectorAll('.tasks-table tbody tr')].filter(row => row.querySelector('.overdue')).map(row => row.cells[1].textContent);
          const dueOrder = rows();
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
          return { ascending, descending, keptFocus, filtered, noMatch, remainingFiltered, remaining: rows(), overdueRows, dueOrder,
            columnWidths, horizontalOverflow, scrollAtEnd, scrollAfterSort, scrollAfterFilter };
        })()`);
        assert.ok(table.horizontalOverflow, 'Table should scroll horizontally in a narrow window');
        assert.ok(table.columnWidths[1] >= 180, 'Task column should have room for descriptions');
        assert.ok(table.columnWidths[2] >= 120, 'Responsible column should remain readable');
        assert.ok(table.columnWidths[6] >= 120, 'Deadline column should remain readable');
        assert.ok(table.scrollAtEnd > 0);
        assert.equal(table.scrollAfterSort, table.scrollAtEnd);
        assert.equal(table.scrollAfterFilter, table.scrollAtEnd);
        assert.deepEqual(table.ascending, ['Budget prüfen', 'Veranstaltungsort kontaktieren']);
        assert.deepEqual(table.overdueRows, ['Veranstaltungsort kontaktieren']);
        assert.deepEqual(table.dueOrder, ['Veranstaltungsort kontaktieren', 'Budget prüfen']);
        assert.deepEqual(table.descending, ['Veranstaltungsort kontaktieren', 'Budget prüfen']);
        assert.ok(table.keptFocus);
        assert.deepEqual(table.filtered, ['Budget prüfen']);
        assert.ok(table.noMatch);
        assert.match(table.remainingFiltered, /Keine Aufgaben entsprechen den Filtern/);
        assert.deepEqual(table.remaining, ['Veranstaltungsort kontaktieren']);
        const afterTable = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(afterTable.meeting.points[0].tasks[0].done, true);
        assert.equal(afterTable.meeting.points[0].tasks[0].completedDate, today);
        assert.equal(afterTable.meeting.points[1].tasks[0].done, false);
        assert.equal(afterTable.meeting.points[0].tasks[0].dueDate, today);
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
            responsible: document.querySelector('[data-point="1"][data-field="responsible"]').value,
            openAvailable: !!document.querySelector('[data-action="open-protocol"]') };
        })()`);
        assert.match(completion.conflict, /auf dem Datenträger geändert/);
        assert.doesNotMatch(completion.conflict, /Error invoking remote method/);
        assert.ok(completion.stillOpen);
        assert.ok(completion.empty);
        assert.ok(completion.checked);
        assert.equal(completion.responsible, 'TOP Leitung & Team');
        assert.ok(completion.openAvailable);
        const completed = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(completed.meeting.points[1].tasks[0].done, true);
        assert.equal(completed.meeting.points[1].tasks[0].completedDate, today);
        assert.equal(completed.meeting.points[1].tasks[0].responsible, 'Updated externally');
        const reopen = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (test) => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for meeting save');
          };
          const checkbox = document.querySelector('[data-point="1"][data-field="done"]');
          const priorLabel = checkbox.closest('.meeting-task-row').querySelector('.task-completed-date').textContent;
          checkbox.click();
          const clearedLabel = checkbox.closest('.meeting-task-row').querySelector('.task-completed-date').textContent;
          document.querySelector('[data-action="save"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Sitzung gespeichert.');
          return { priorLabel, clearedLabel };
        })()`);
        assert.match(reopen.priorLabel, /Erledigt am:/);
        assert.equal(reopen.clearedLabel, '');
        const reopened = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(reopened.meeting.points[1].tasks[0].done, false);
        assert.equal(reopened.meeting.points[1].tasks[0].completedDate, undefined);
        await window.webContents.executeJavaScript(`(async () => {
          const checkbox = document.querySelector('[data-point="1"][data-field="done"]');
          checkbox.click();
          document.querySelector('[data-action="save"]').click();
          for (let i = 0; i < 200; i++) {
            if (!checkbox.isConnected && document.querySelector('.notice')?.textContent === 'Sitzung gespeichert.') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Timed out waiting for meeting save');
        })()`);
        const recompleted = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(recompleted.meeting.points[1].tasks[0].completedDate, today);
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
        await fs.unlink(cssFile);
        const cssError = await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="export"]').click();
          for (let i = 0; i < 200; i++) {
            const text = document.querySelector('.notice.error')?.textContent;
            if (text?.includes('CSS-Datei')) return text;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Missing CSS error timed out');
        })()`);
        assert.match(cssError, /CSS-Datei.*nicht gelesen/);
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('CSS reset timed out');
          };
          document.querySelector('[data-view="settings"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-protocol-css"]'));
          document.querySelector('[data-action="reset-protocol-css"]').click();
          await waitFor(() => document.querySelector('[data-protocol-css]')?.textContent.includes('Standardlayout'));
          document.querySelector('[data-view="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="select"]'));
          document.querySelector('[data-action="select"]').click();
          await waitFor(() => document.querySelector('[data-action="export"]'));
          document.querySelector('[data-action="export"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.deepEqual(pdfColors, ['rgb(65, 43, 21)', 'rgb(36, 41, 47)']);
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { folder: data, protocolCss: null });
        for (const module of ['members', 'letters', 'invoices']) {
          assert.ok((await fs.stat(path.join(data, module))).isDirectory());
        }
        const { protocolHtml } = require('../src/main/protocol');
        const defaultCss = await fs.readFile(path.join(__dirname, '../src/shared/document.css'), 'utf8');
        const layoutMeeting = {
          title: 'Layouttest', date: '', attendance: [
            ...['Alex', 'Sam', 'Kim', 'Jo', 'Max', 'Mia'].map(name => ({ name, status: 'attending' })),
            { name: 'Lisa', status: 'excused' }
          ],
          points: ['discussion', 'decision', 'info'].map(type => ({
            type, headline: 'LangeÜberschrift'.repeat(12), details: 'Details', tasks: []
          }))
        };
        const layoutWindow = new BrowserWindow({ show: false, width: 650, height: 800, webPreferences: { sandbox: true } });
        try {
          await layoutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(protocolHtml(layoutMeeting, defaultCss))}`);
          const pills = await layoutWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.point-heading'), heading => {
            const title = heading.querySelector('h3');
            const pill = heading.querySelector('.type');
            const titleRect = title.getBoundingClientRect();
            const pillRect = pill.getBoundingClientRect();
            const headingRect = heading.getBoundingClientRect();
            const style = getComputedStyle(pill);
            return { text: pill.textContent, color: style.backgroundColor, radius: style.borderTopLeftRadius,
              titleRight: titleRect.right, pillLeft: pillRect.left, pillRight: pillRect.right,
              headingRight: headingRect.right, pillTop: pillRect.top, headingTop: headingRect.top };
          })`);
          assert.deepEqual(pills.map(pill => pill.text), ['Diskussion', 'Entscheidung', 'Information']);
          assert.equal(new Set(pills.map(pill => pill.color)).size, 3);
          for (const pill of pills) {
            assert.notEqual(pill.color, 'rgba(0, 0, 0, 0)');
            assert.ok(parseFloat(pill.radius) > 0);
            assert.ok(pill.titleRight <= pill.pillLeft && Math.abs(pill.pillRight - pill.headingRight) < 1);
            assert.ok(Math.abs(pill.pillTop - pill.headingTop) < 1);
          }
          const attendanceLayout = await layoutWindow.webContents.executeJavaScript(`(() => {
            const groups = [...document.querySelectorAll('.attendance-group')];
            const first = groups[0];
            const lineHeight = parseFloat(getComputedStyle(first).lineHeight);
            return { text: groups.map(group => group.textContent), height: first.getBoundingClientRect().height, lineHeight };
          })()`);
          assert.deepEqual(attendanceLayout.text, [
            'Anwesend: Alex, Sam, Kim, Jo, Max, Mia',
            'Entschuldigt abwesend: Lisa'
          ]);
          assert.ok(attendanceLayout.height <= attendanceLayout.lineHeight * 1.1, 'Multiple participants should fit on one line');
          const logo = await layoutWindow.webContents.executeJavaScript(`(async () => {
            const page = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
              .find(rule => rule.cssRules && [...rule.cssRules].some(child =>
                child.cssText.startsWith('@top-right') && child.style.backgroundImage !== ''));
            const rule = [...page.cssRules].find(child => child.cssText.startsWith('@top-right'));
            const background = rule.style.backgroundImage;
            const url = background.slice(4, -1).replace(/^["']|["']$/g, '');
            const image = new Image();
            image.src = url;
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight, background };
          })()`);
          assert.ok(logo.width > 0 && logo.height > 0);
          assert.match(logo.background, /data:image\/svg\+xml/);
          const layoutPdf = await layoutWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
          assert.equal(layoutPdf.subarray(0, 5).toString(), '%PDF-');
        } finally {
          layoutWindow.destroy();
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
