const { app, BrowserWindow, dialog, shell } = require('electron');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function main() {
  app.setVersion(require('../package.json').version);
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
  const pdfVoteResults = [];
  const pdfOpenTasks = [];
  app.on('browser-window-created', (event, window) => {
    if (window.isVisible()) return;
    const printToPDF = window.webContents.printToPDF.bind(window.webContents);
    window.webContents.printToPDF = async options => {
      pdfColors.push(await window.webContents.executeJavaScript('getComputedStyle(document.body).color'));
      pdfPointHeadings.push(await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.point-heading h3'), element => element.textContent)`));
      pdfVoteResults.push(await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.vote-result'), element => element.textContent)`));
      pdfOpenTasks.push(await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.open-task-group'), group => ({ name: group.querySelector('h3').textContent,
          tasks: [...group.querySelectorAll('li')].map(item => item.textContent) }))`));
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
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (document.querySelector('main h1')?.textContent !== 'Versionsverlauf' ||
              !document.querySelector('main').textContent.includes('Version ${app.getVersion()}')) {
            throw new Error('First launch must show the current version history: ' +
              JSON.stringify({ heading: document.querySelector('main h1')?.textContent,
                content: document.querySelector('main').textContent, expectedVersion: '${app.getVersion()}' }));
          }
        })()`);
        const reloadFinished = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await reloadFinished;
        await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (document.querySelector('main h1')?.textContent === 'Versionsverlauf') throw new Error('Same version must not reopen history');
          document.querySelector('[data-view="changelog"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('main h1')?.textContent === 'Versionsverlauf') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Version history must be accessible without a data folder');
        })()`);
        const originalVersion = app.getVersion();
        const [major, minor, patch] = originalVersion.split('.').map(Number);
        app.setVersion(`${major}.${minor}.${patch + 1}`);
        const updatedReload = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await updatedReload;
        await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (document.querySelector('main h1')?.textContent !== 'Versionsverlauf') throw new Error('A changed version must reopen history');
        })()`);
        app.setVersion(originalVersion);
        const restoredReload = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await restoredReload;
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for UI');
          };
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          document.querySelector('[data-view="settings"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('[data-action="choose-protocol-css"]')) break;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (!document.querySelector('[data-protocol-css]').textContent.includes('Standardlayout')) throw new Error('Missing default CSS');
          if (document.querySelector('[data-app-version]')?.textContent !== 'Version: ${app.getVersion()}') {
            throw new Error('Settings must display the running app version without a data folder');
          }
          const tabNames = [...document.querySelectorAll('[data-settings-tab]')].map(tab => tab.textContent);
          if (tabNames.join('|') !== 'Allgemein|Sitzungen|Mitglieder|Rechnungen|Briefe') throw new Error('Every module must have a settings tab');
          const defaultModules = { meetings: true, members: false, invoices: false, letters: false };
          for (const [module, enabled] of Object.entries(defaultModules)) {
            if (document.querySelector('[data-settings-tab="' + module + '"]') === null) throw new Error('Missing module settings tab: ' + module);
            const nav = document.querySelector('[data-module-nav="' + module + '"]') ||
              document.querySelector('[data-module-view="' + module + '"]');
            if (nav.hidden === enabled) throw new Error('Unexpected default sidebar visibility for ' + module);
          }
          const setModule = async (module, enabled) => {
            await waitFor(() => !document.body.inert);
            document.querySelector('[data-settings-tab="' + module + '"]').click();
            await waitFor(() => document.querySelector('[data-module-toggle="' + module + '"]'));
            const toggle = document.querySelector('[data-module-toggle="' + module + '"]');
            toggle.checked = enabled;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
            await waitFor(() => !document.body.inert && (
              (document.querySelector('[data-module-nav="' + module + '"]') ||
                document.querySelector('[data-module-view="' + module + '"]')).hidden === !enabled));
          };
          await setModule('members', true);
          await setModule('invoices', true);
          await setModule('letters', true);
          await setModule('letters', false);
          if (!document.querySelector('[data-module-view="letters"]').hidden) throw new Error('Disabled module remains in sidebar');
          await setModule('letters', true);
          await setModule('meetings', false);
          if (!document.querySelector('[data-view="statistics"]').hidden ||
              !document.querySelector('[data-module-nav="meetings"]').hidden) throw new Error('Disabled statistics navigation remains visible');
          await setModule('meetings', true);
          if (document.querySelector('[data-view="statistics"]').hidden) throw new Error('Enabled statistics navigation is hidden');
          if (JSON.stringify(await window.club.getModules()) !== JSON.stringify({ meetings: true, members: true, invoices: true, letters: true })) {
            throw new Error('Enabled modules were not persisted');
          }
          document.querySelector('[data-settings-tab="general"]').click();
          await waitFor(() => document.querySelector('[data-action="choose-protocol-css"]'));
          document.querySelector('[data-action="choose-protocol-css"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('[data-action="reset-protocol-css"]')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('CSS selection timed out');
        })()`);
        const settingsFile = path.join(app.getPath('userData'), 'settings.json');
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), {
          folder: null, protocolCss: cssFile, modules: { meetings: true, members: true, invoices: true, letters: true }, lastSeenVersion: app.getVersion()
        });
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
          if (document.querySelector('[data-app-version]')?.textContent !== 'Version: ${app.getVersion()}') {
            throw new Error('Settings must display the running app version with a data folder');
          }
          await click('[data-view="meetings"]');
          await waitFor(() => document.querySelector('.list'));
          await click('[data-view="statistics"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Statistiken');
          if (document.querySelector('[data-stat-open]').textContent !== '0' ||
              !document.querySelector('main').textContent.includes('keine Aufgaben mit ausreichend gültigen Datumsangaben')) {
            throw new Error('Empty statistics view is incorrect');
          }
          await click('[data-view="decisions"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Entscheidungen');
          if (!document.querySelector('main').textContent.includes('Keine Entscheidungen vorhanden.')) throw new Error('Empty decisions view missing');
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
          const dirtyEditor = document.querySelector('[data-markdown-editor="0"] .cm-editor');
          const meetingToggle = document.querySelector('[data-action="toggle-meeting-nav"]');
          const assertExpanded = expanded => {
            if (meetingToggle.getAttribute('aria-expanded') !== String(expanded) ||
                document.querySelector('#meeting-subnav').hidden === expanded) {
              throw new Error('Meeting heading did not toggle its subnavigation');
            }
          };
          assertExpanded(true);
          meetingToggle.querySelector('.nav-icon').click();
          assertExpanded(false);
          meetingToggle.querySelector('.nav-label').click();
          assertExpanded(true);
          meetingToggle.querySelector('.nav-chevron').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          assertExpanded(false);
          meetingToggle.click();
          assertExpanded(true);
          if (document.querySelector('[data-markdown-editor="0"] .cm-editor') !== dirtyEditor ||
              document.querySelector('[data-field="title"]').value !== 'Beispiel: Vorstandssitzung') {
            throw new Error('Collapsing navigation must preserve unsaved editor state');
          }
          const originalConfirm = window.confirm;
          window.confirm = () => false;
          await click('[data-view="decisions"]');
          await waitFor(() => !document.body.inert);
          window.confirm = originalConfirm;
          if (document.querySelector('main h1')?.textContent !== 'Sitzung bearbeiten' ||
              document.querySelector('[data-field="title"]').value !== 'Beispiel: Vorstandssitzung') {
            throw new Error('Declining to discard must preserve the meeting');
          }
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
          if (document.querySelector('[data-action="add-task"][data-index="1"]')) throw new Error('Decision TOP must not allow adding tasks');
          const voteSelect = document.querySelector('[data-point="1"][data-vote-result]');
          const voteOptions = [...voteSelect.options].map(option => option.textContent);
          if (voteOptions.join('|') !== 'Kein Ergebnis ausgewählt|Einstimmig angenommen|Einstimmig abgelehnt|Angenommen mit|Abgelehnt mit') {
            throw new Error('Unexpected vote options: ' + voteOptions);
          }
          setInput('[data-point="1"][data-vote-result]', 'unanimous_accepted');
          if (!document.querySelector('[data-point="1"][data-vote-count="yes"]').closest('.vote-counts').hidden) throw new Error('Unanimous vote should hide counts');
          setInput('[data-point="1"][data-vote-result]', 'accepted');
          if (document.querySelector('[data-point="1"][data-vote-count="yes"]').closest('.vote-counts').hidden) throw new Error('Mixed vote should show counts');
          setInput('[data-point="1"][data-vote-count="yes"]', '5');
          setInput('[data-point="1"][data-vote-count="no"]', '1');
          setInput('[data-point="1"][data-vote-count="abstain"]', '0');
          setInput('[data-point="1"][data-vote-result]', 'unanimous_rejected');
          setInput('[data-point="1"][data-vote-result]', 'rejected');
          if (document.querySelector('[data-point="1"][data-vote-count="yes"]').value !== '5') throw new Error('Vote counts must survive result changes');
          setInput('[data-point="1"][data-vote-result]', 'accepted');
          const initialEditor = document.querySelector('[data-markdown-editor="0"] .cm-content');
          initialEditor.focus();
          document.execCommand('insertText', false, 'Den **Veranstaltungsplan** und den Veranstaltungsort besprechen.');
          await click('[data-action="add-task"][data-index="0"]');
          await waitFor(() => document.querySelector('[data-point="0"][data-task="0"][data-field="description"]'));
          setInput('[data-point="0"][data-task="0"][data-field="description"]', 'Veranstaltungsort kontaktieren');
          setInput('[data-point="0"][data-task="0"][data-field="responsible"]', 'Alex Beispiel');
          setInput('[data-point="0"][data-field="type"]', 'decision');
          if (document.querySelector('[data-point="0"][data-field="type"]').value !== 'discussion' ||
              !document.querySelector('.notice.error')?.textContent.includes('Entfernen Sie zuerst die Aufgaben')) {
            throw new Error('Changing a TOP with tasks to a decision should be blocked');
          }
          const absentBeforeExport = !document.querySelector('[data-action="open-protocol"]');
          const language = document.documentElement.lang;
          const navigation = [...document.querySelectorAll('[data-view]')].map(button => button.getAttribute('aria-label'));
          const visibleNavigation = [...document.querySelectorAll('[data-view]')].map(button => {
            const label = button.querySelector('.nav-label');
            const icon = button.querySelector('.nav-icon');
            const labelRect = label.getBoundingClientRect();
            const iconRect = icon.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            return { text: label.textContent, visible: getComputedStyle(label).visibility === 'visible' &&
              labelRect.width > 0 && labelRect.left >= iconRect.right && labelRect.right <= buttonRect.right };
          });
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
          const toggle = document.querySelector('[data-action="toggle-meeting-nav"]');
          toggle.click();
          if (toggle.getAttribute('aria-expanded') !== 'false' || !document.querySelector('#meeting-subnav').hidden ||
              document.querySelector('main h1')?.textContent !== 'Sitzung bearbeiten') throw new Error('Meeting navigation did not collapse independently');
          toggle.click();
          if (toggle.getAttribute('aria-expanded') !== 'true' || document.querySelector('#meeting-subnav').hidden) throw new Error('Meeting navigation did not expand');
          await click('[data-view="tasks"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Offene Aufgaben');
          return { notice, tasks: document.querySelector('main').textContent, overdue: document.querySelectorAll('.overdue').length, language, navigation, visibleNavigation, attendanceOptions, typeOptions, absentBeforeExport, previewText, rawVisible, editedPreview, renderedLink, bullets, numbers, tasksBefore, persistedChecks, topBefore, toolbarTop, containerTop, scrolled, stickyVisible, savedScroll, afterExportVisible, noOverlap };
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
        assert.deepEqual(result.navigation, ['Sitzungen', 'Offene Aufgaben', 'Entscheidungen', 'Alle TOPs', 'Statistiken', 'Mitglieder', 'Rechnungen', 'Briefe', 'Versionsverlauf', 'Einstellungen']);
        assert.deepEqual(result.visibleNavigation.map(item => item.text), result.navigation);
        assert.ok(result.visibleNavigation.every(item => item.visible), 'Navigation labels must be visible next to their icons');
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
        assert.deepEqual(saved.meeting.points[0].vote, { result: 'accepted', yes: 5, no: 1, abstain: 0 });
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
        assert.deepEqual(pdfVoteResults, [['Abstimmung: Angenommen mit 5 Ja-Stimmen, 1 Gegenstimmen, 0 Enthaltungen']]);
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), {
          folder: data, protocolCss: cssFile, modules: { meetings: true, members: true, invoices: true, letters: true }, lastSeenVersion: app.getVersion()
        });
        assert.deepEqual(openedPaths, [path.join(meetingsDir, 'protocols', `${saved.meeting.id}.pdf`)]);
        const corruptMeeting = path.join(meetingsDir, `${randomUUID()}.json`);
        await fs.writeFile(corruptMeeting, '{');
        try {
          await window.webContents.executeJavaScript(`(async () => {
            document.querySelector('[data-view="changelog"]').click();
            for (let i = 0; i < 200; i++) {
              if (document.querySelector('main h1')?.textContent === 'Versionsverlauf') {
                if (document.querySelector('.notice.error')) throw new Error('History must not load meeting data');
                return;
              }
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('History must open even if meeting data is invalid');
          })()`);
        } finally {
          await fs.unlink(corruptMeeting);
        }
        const earlierFiles = [];
        let undatedId;
        for (const [date, description] of [['2000-01-01', 'Alte offene Aufgabe'], [saved.meeting.date, 'Gleicher Tag'], ['9999-12-31', 'Zukünftige Aufgabe'], ['', 'Ohne Datum']]) {
          const record = { version: 1, meeting: { id: randomUUID(), title: 'Andere Sitzung', date, attendance: [],
            points: [{ headline: 'Alter TOP', type: 'discussion', details: '', tasks: [
              { description, responsible: 'Alex Beispiel; Sam', done: false },
              { description: 'Alte erledigte Aufgabe', responsible: 'Sam', done: true }
            ] }] } };
          const file = path.join(meetingsDir, `${record.meeting.id}.json`);
          if (!date) undatedId = record.meeting.id;
          earlierFiles.push(file);
          await fs.writeFile(file, JSON.stringify(record));
        }
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for PDF export');
          };
          document.querySelector('[data-view="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="select"][data-id="${saved.meeting.id}"]'));
          document.querySelector('[data-action="select"][data-id="${saved.meeting.id}"]').click();
          await waitFor(() => document.querySelector('[data-include-earlier-tasks]'));
          const option = document.querySelector('[data-include-earlier-tasks]');
          if (option.checked) throw new Error('Earlier tasks must be unchecked by default');
          option.click();
          document.querySelector('[data-action="export"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
          if (!document.querySelector('[data-include-earlier-tasks]').checked) throw new Error('Export option should survive rerender');
          document.querySelector('[data-include-earlier-tasks]').click();
          document.querySelector('[data-action="export"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert') && !document.body.inert);
        })()`);
        const included = pdfOpenTasks.at(-2);
        const excluded = pdfOpenTasks.at(-1);
        for (const name of ['Alex Beispiel', 'Sam']) {
          assert.ok(included.find(group => group.name === name)?.tasks.some(task => task.includes('Alte offene Aufgabe')));
        }
        assert.ok(included.some(group => group.tasks.some(task => task.includes('Veranstaltungsort kontaktieren'))));
        assert.ok(!included.some(group => group.tasks.some(task => /Gleicher Tag|Zukünftige Aufgabe|Ohne Datum|Alte erledigte Aufgabe/.test(task))));
        assert.ok(!excluded.some(group => group.tasks.some(task => task.includes('Alte offene Aufgabe'))));
        const missingDateError = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for date validation');
          };
          document.querySelector('[data-action="select"][data-id="${undatedId}"]').click();
          await waitFor(() => document.querySelector('[data-field="title"]')?.value === 'Andere Sitzung');
          document.querySelector('[data-include-earlier-tasks]').click();
          document.querySelector('[data-action="export"]').click();
          return await waitFor(() => document.querySelector('.notice.error')?.textContent);
        })()`);
        assert.match(missingDateError, /gültiges Sitzungsdatum/);
        for (const file of earlierFiles) await fs.unlink(file);
        const statsRecord = { version: 1, meeting: { id: randomUUID(), title: 'Statistiktest', date: '2000-01-01', attendance: [],
          points: [{ headline: 'Statistik', type: 'discussion', details: '', tasks: [
            { description: 'Offen', responsible: '', done: false, dueDate: '2000-01-02' },
            { description: 'Erledigt', responsible: '', done: true, completedDate: '2000-01-03' },
            { description: 'Alt', responsible: '', done: true }
          ] }] } };
        const statsFile = path.join(meetingsDir, `${statsRecord.meeting.id}.json`);
        await fs.writeFile(statsFile, JSON.stringify(statsRecord));
        const statistics = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for statistics');
          };
          document.querySelector('[data-view="statistics"]').click();
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Statistiken');
          const expected = clubTaskStatistics.summarize(await window.club.listMeetings());
          const actual = {
            open: Number(document.querySelector('[data-stat-open]').textContent),
            completed: Number(document.querySelector('[data-stat-completed]').textContent),
            overdue: Number(document.querySelector('[data-stat-overdue]').textContent),
            points: [...document.querySelectorAll('.statistics-data tbody tr')].map(row => ({
              date: row.cells[0].textContent, open: Number(row.cells[1].textContent)
            })),
            description: document.querySelector('main').textContent,
            circles: document.querySelectorAll('.statistics-point').length
          };
          document.querySelector('[data-action="refresh-statistics"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Statistiken neu geladen.');
          return { actual, expected, formatted: expected.points.map(point => ({ date: clubDates.formatDate(point.date), open: point.open })) };
        })()`);
        assert.equal(statistics.actual.open, statistics.expected.open);
        assert.equal(statistics.actual.completed, statistics.expected.completed);
        assert.equal(statistics.actual.overdue, statistics.expected.overdue);
        assert.deepEqual(statistics.actual.points, statistics.formatted);
        assert.equal(statistics.actual.circles, statistics.expected.points.length);
        assert.match(statistics.actual.description, /ausgeschlossen: 1/);
        await fs.unlink(statsFile);
        const fixture = structuredClone(saved);
        fixture.meeting.points.push(
          { headline: 'Alt <Beschluss>', type: 'decision', details: 'Zweite Entscheidung', tasks: [] },
          { headline: 'Ablehnung', type: 'decision', details: '', tasks: [], vote: { result: 'unanimous_rejected', yes: null, no: null, abstain: null } },
          { headline: 'Keine Entscheidung', type: 'info', details: '', tasks: [], vote: { result: 'accepted', yes: 2, no: null, abstain: null } }
        );
        fixture.meeting.points[0].details = 'Budget <img src=x> prüfen\nZweite Zeile';
        fixture.meeting.points[1].details = 'Veranstaltungsplan besprechen';
        await fs.writeFile(path.join(meetingsDir, jsonFile), JSON.stringify(fixture, null, 2) + '\n');
        const second = structuredClone(saved);
        second.meeting.id = randomUUID();
        second.meeting.title = 'Weitere Sitzung';
        second.meeting.date = '';
        second.meeting.points = [{ headline: 'Weitere Entscheidung', type: 'decision', details: '', tasks: [],
          vote: { result: 'accepted', yes: null, no: null, abstain: null } }];
        const secondFile = path.join(meetingsDir, `${second.meeting.id}.json`);
        await fs.writeFile(secondFile, JSON.stringify(second, null, 2) + '\n');
        const decisions = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for decisions');
          };
          const click = async selector => {
            const element = await waitFor(() => !document.body.inert && document.querySelector(selector));
            if (!element) throw new Error('Element not found: ' + selector);
            element.click();
          };
          document.querySelector('[data-view="decisions"]').click();
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Entscheidungen');
          const rows = [...document.querySelectorAll('.decisions-table tbody tr')].map(row => ({
            cells: [...row.querySelectorAll('td')].map(cell => cell.textContent),
            color: getComputedStyle(row.querySelector('.decision-result')).backgroundColor
          }));
          if (document.querySelector('.decisions-table img')) throw new Error('Decision title was not escaped');
          const firstDetails = '[data-action="toggle-decision-details"][data-id="${saved.meeting.id}"][data-index="0"]';
          const secondDetails = '[data-action="toggle-decision-details"][data-id="${saved.meeting.id}"][data-index="2"]';
          const emptyDetails = '[data-action="toggle-decision-details"][data-id="${second.meeting.id}"][data-index="0"]';
          if (document.querySelector('.decisions-table .top-details-row')) throw new Error('Decision details must initially be collapsed');
          await click(firstDetails);
          const firstButton = document.querySelector(firstDetails);
          const firstRow = firstButton.closest('tr').nextElementSibling;
          if (firstButton.getAttribute('aria-expanded') !== 'true' || document.activeElement !== firstButton ||
              firstRow?.cells[0].colSpan !== 6 || firstRow.querySelector('.top-details-content')?.id !== firstButton.getAttribute('aria-controls') ||
              firstRow.querySelector('.top-details-content')?.textContent !== 'Budget <img src=x> prüfen\\nZweite Zeile' ||
              firstRow.querySelector('img')) throw new Error('Decision details should expand safely across the table and retain focus');
          await click(secondDetails);
          if (document.querySelectorAll('.decisions-table .top-details-row').length !== 1 ||
              document.querySelector(secondDetails).closest('tr').nextElementSibling.textContent !== 'Zweite Entscheidung' ||
              document.querySelector(firstDetails).getAttribute('aria-expanded') !== 'false') throw new Error('Only the selected decision should be expanded');
          await click(emptyDetails);
          if (document.querySelector(emptyDetails).closest('tr').nextElementSibling.textContent !== 'Keine Details vorhanden.') {
            throw new Error('Empty decision details must show a placeholder');
          }
          await click(emptyDetails);
          if (document.querySelector('.decisions-table .top-details-row')) throw new Error('Decision details must collapse');
          const search = document.querySelector('[data-decision-search]');
          const filter = value => {
            search.focus();
            search.value = value;
            search.dispatchEvent(new Event('input', { bubbles: true }));
            if (document.activeElement !== search) throw new Error('Search must retain focus while filtering');
            return [...document.querySelectorAll('.decisions-table tbody tr')].map(row => row.cells[0].textContent);
          };
          const searches = {
            title: filter('  bUDgEt  '),
            result: filter('einstimmig abgelehnt'),
            meeting: filter('weitere sitzung'),
            date: filter(clubDates.formatDate(clubDates.localDate())),
            isoDate: filter(clubDates.localDate()),
            none: filter('kein treffer'),
            emptyMessage: document.querySelector('#decision-results').textContent,
            cleared: filter('')
          };
          const resultFilter = document.querySelector('[data-decision-result]');
          const filterResult = value => {
            resultFilter.value = value;
            resultFilter.dispatchEvent(new Event('change', { bubbles: true }));
            return [...document.querySelectorAll('[data-decision-row]')].map(row => row.cells[0].textContent);
          };
          if ([...resultFilter.options].map(option => option.value).join('|') !==
              '|none|all_accepted|all_rejected|unanimous_accepted|unanimous_rejected|accepted|rejected') throw new Error('Missing outcome filter options');
          if (filterResult('none').join('|') !== 'Alt <Beschluss>') throw new Error('Missing outcome filter must include legacy decisions');
          if (filterResult('unanimous_rejected').join('|') !== 'Ablehnung') throw new Error('Unanimous rejection filter failed');
          if (filterResult('accepted').length !== 2) throw new Error('Acceptance filter must include both decisions with and without vote counts');
          if (filterResult('rejected').length !== 0 || !document.querySelector('#decision-results').textContent.includes('Keine Entscheidungen entsprechen den Filtern.')) {
            throw new Error('Empty outcome filter must be reported');
          }
          if (filterResult('unanimous_accepted').length !== 0) throw new Error('Unanimous acceptance filter failed');
          filterResult('accepted');
          filter('budget');
          if (document.querySelectorAll('[data-decision-row]').length !== 1) throw new Error('Search and outcome filters must combine');
          document.querySelector('[data-action="refresh-decisions"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Entscheidungen neu geladen.');
          if (document.querySelector('[data-decision-search]').value !== 'budget' ||
              document.querySelector('[data-decision-result]').value !== 'accepted' ||
              document.querySelectorAll('.decisions-table tbody tr').length !== 1) throw new Error('Reload must preserve both filters');
          document.querySelector('[data-action="select-decision-meeting"]').click();
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Sitzung bearbeiten');
          const title = document.querySelector('[data-field="title"]').value;
          await click('[data-view="tops"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Alle TOPs');
          const totalTopCount = document.querySelectorAll('[data-top-row]').length;
          const topHeaders = [...document.querySelectorAll('.tops-table thead th')].map(header => header.textContent);
          const initialTopRow = document.querySelector('[data-top-row]');
          const initialTopTitle = initialTopRow.cells[0].textContent;
          const initialTopDate = initialTopRow.cells[5].textContent;
          const expectedMeetingDate = clubDates.formatDate('${saved.meeting.date}');
          const setTopFilter = (name, value, eventName) => {
            const filter = document.querySelector('[data-top-filter="' + name + '"]');
            filter.value = value;
            filter.dispatchEvent(new Event(eventName, { bubbles: true }));
          };
          const allTopDetails = [...document.querySelectorAll('[data-top-row]')].map(row => row.cells[2].textContent);
          const typeBadge = document.querySelector('[data-top-row] .top-type');
          const typeBadgeRadius = getComputedStyle(typeBadge).borderRadius;
          const typeBadgeClass = [...typeBadge.classList].find(name => name.startsWith('top-type-'));
          const detailsToggle = '[data-top-row] .top-details-toggle[data-id="${saved.meeting.id}"][data-index="1"]';
          const detailsInitiallyHidden = !document.querySelector('.top-details-row');
          await click(detailsToggle);
          const expandedDetailsRow = document.querySelector('.top-details-row');
          const detailsExpanded = expandedDetailsRow?.cells[0].colSpan === 7 &&
            expandedDetailsRow.querySelector('.top-details-content')?.textContent.includes('Veranstaltungsplan besprechen') &&
            document.querySelector(detailsToggle).getAttribute('aria-expanded') === 'true';
          await click(detailsToggle);
          const detailsCollapsed = !document.querySelector('.top-details-row');
          setTopFilter('search', 'veranstaltungsplan', 'input');
          const detailSearch = [...document.querySelectorAll('[data-top-row]')].map(row => row.cells[0].textContent);
          if (!detailSearch.length) throw new Error('TOP details search failed: ' + JSON.stringify({ allTopDetails, search: document.querySelector('[data-top-filter="search"]').value }));
          setTopFilter('search', '', 'input');
          setTopFilter('type', 'decision', 'change');
          const decisionTopCount = document.querySelectorAll('[data-top-row]').length;
          setTopFilter('meeting', '${second.meeting.id}', 'change');
          const filteredTopCount = document.querySelectorAll('[data-top-row]').length;
          setTopFilter('type', '', 'change');
          setTopFilter('meeting', '', 'change');
          setTopFilter('type', 'discussion', 'change');
          document.querySelector('[data-action="refresh-tops"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'TOPs neu geladen.');
          const filterPreserved = document.querySelector('[data-top-filter="type"]').value === 'discussion' &&
            document.querySelectorAll('[data-top-row]').length === 1;
          await click('[data-action="clear-top-filters"]');
          await waitFor(() => document.querySelectorAll('[data-top-row]').length === totalTopCount);
          await click('[data-action="select-top-meeting"][data-id="${second.meeting.id}"]');
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Sitzung bearbeiten');
          const openedTopMeeting = document.querySelector('[data-field="title"]').value;
          document.querySelector('[data-view="tasks"]').click();
          await waitFor(() => document.querySelector('main h1')?.textContent === 'Offene Aufgaben');
          return { rows, title, searches, tops: { totalTopCount, topHeaders, initialTopTitle, initialTopDate, expectedMeetingDate, detailSearch, decisionTopCount, filteredTopCount, filterPreserved, openedTopMeeting,
            typeBadge: typeBadge.textContent, typeBadgeClass, typeBadgeRadius, detailsInitiallyHidden, detailsExpanded, detailsCollapsed } };
        })()`);
        assert.equal(decisions.rows.length, 4);
        assert.deepEqual(decisions.rows.map(row => row.cells[0]), ['Budget', 'Alt <Beschluss>', 'Ablehnung', 'Weitere Entscheidung']);
        assert.match(decisions.rows[0].cells[1], /Angenommen mit 5 Ja-Stimmen, 1 Gegenstimmen, 0 Enthaltungen/);
        assert.equal(decisions.rows[1].cells[1], 'Kein Ergebnis ausgewählt');
        assert.equal(decisions.rows[2].cells[1], 'Einstimmig abgelehnt');
        assert.equal(decisions.rows[3].cells[1], 'Angenommen');
        assert.equal(decisions.rows[3].cells[2], 'Weitere Sitzung');
        assert.equal(decisions.rows[3].cells[3], 'Kein Datum');
        assert.equal(decisions.rows[0].color, 'rgb(255, 240, 207)');
        assert.equal(decisions.rows[2].color, 'rgb(253, 225, 225)');
        assert.deepEqual(decisions.searches.title, ['Budget']);
        assert.deepEqual(decisions.searches.result, ['Ablehnung']);
        assert.deepEqual(decisions.searches.meeting, ['Weitere Entscheidung']);
        assert.deepEqual(decisions.searches.date, ['Budget', 'Alt <Beschluss>', 'Ablehnung']);
        assert.deepEqual(decisions.searches.isoDate, decisions.searches.date);
        assert.deepEqual(decisions.searches.none, []);
        assert.match(decisions.searches.emptyMessage, /Keine Entscheidungen entsprechen der Suche/);
        assert.equal(decisions.searches.cleared.length, 4);
        assert.equal(decisions.title, saved.meeting.title);
        assert.equal(decisions.tops.totalTopCount, 6);
        assert.deepEqual(decisions.tops.topHeaders, ['TOP', 'Typ', 'Details', 'Verantwortlich', 'Sitzung', 'Datum', 'Aktion']);
        assert.equal(decisions.tops.initialTopTitle, 'Budget');
        assert.equal(decisions.tops.initialTopDate, decisions.tops.expectedMeetingDate);
        assert.deepEqual(decisions.tops.detailSearch, ['Kommende Veranstaltung']);
        assert.equal(decisions.tops.decisionTopCount, 4);
        assert.equal(decisions.tops.filteredTopCount, 1);
        assert.equal(decisions.tops.filterPreserved, true);
        assert.equal(decisions.tops.openedTopMeeting, 'Weitere Sitzung');
        assert.equal(decisions.tops.typeBadge, 'Entscheidung');
        assert.equal(decisions.tops.typeBadgeClass, 'top-type-decision');
        assert.equal(decisions.tops.typeBadgeRadius, '999px');
        assert.equal(decisions.tops.detailsInitiallyHidden, true);
        assert.equal(decisions.tops.detailsExpanded, true);
        assert.equal(decisions.tops.detailsCollapsed, true);
        const grouped = structuredClone(second);
        grouped.meeting.id = randomUUID();
        grouped.meeting.title = 'Gruppierte Ergebnisse';
        grouped.meeting.points = [
          ['Einstimmig Ja', 'unanimous_accepted'],
          ['Mehrheitlich Ja', 'accepted'],
          ['Einstimmig Nein', 'unanimous_rejected'],
          ['Mehrheitlich Nein', 'rejected']
        ].map(([headline, result]) => ({ headline, type: 'decision', details: '', tasks: [],
          vote: { result, yes: null, no: null, abstain: null } }));
        const groupedFile = path.join(meetingsDir, `${grouped.meeting.id}.json`);
        await fs.writeFile(groupedFile, JSON.stringify(grouped, null, 2) + '\n');
        try {
          await window.webContents.executeJavaScript(`(async () => {
            const waitFor = async test => {
              for (let i = 0; i < 200; i++) {
                if (test()) return;
                await new Promise(resolve => setTimeout(resolve, 25));
              }
              throw new Error('Timed out waiting for grouped decision filters');
            };
            document.querySelector('[data-view="decisions"]').click();
            await waitFor(() => document.querySelector('[data-decision-result]'));
            const search = document.querySelector('[data-decision-search]');
            const result = document.querySelector('[data-decision-result]');
            const names = () => [...document.querySelectorAll('[data-decision-row]')].map(row => row.cells[0].textContent);
            search.value = 'Gruppierte Ergebnisse';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            for (const [value, expected] of [
              ['all_accepted', ['Einstimmig Ja', 'Mehrheitlich Ja']],
              ['all_rejected', ['Einstimmig Nein', 'Mehrheitlich Nein']],
              ['unanimous_accepted', ['Einstimmig Ja']],
              ['accepted', ['Mehrheitlich Ja']],
              ['unanimous_rejected', ['Einstimmig Nein']],
              ['rejected', ['Mehrheitlich Nein']]
            ]) {
              result.value = value;
              result.dispatchEvent(new Event('change', { bubbles: true }));
              if (JSON.stringify(names()) !== JSON.stringify(expected)) throw new Error('Incorrect filter results for ' + value);
            }
            result.value = 'all_accepted';
            result.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('[data-action="refresh-decisions"]').click();
            await waitFor(() => !document.body.inert && document.querySelector('.notice')?.textContent === 'Entscheidungen neu geladen.');
            if (document.querySelector('[data-decision-result]').value !== 'all_accepted' ||
                JSON.stringify(names()) !== JSON.stringify(['Einstimmig Ja', 'Mehrheitlich Ja'])) {
              throw new Error('Grouped filter must survive reload');
            }
            document.querySelector('[data-view="tasks"]').click();
            await waitFor(() => document.querySelector('main h1')?.textContent === 'Offene Aufgaben');
          })()`);
        } finally {
          await fs.unlink(groupedFile);
        }
        await fs.unlink(secondFile);
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
            contentOverflows: document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth,
            responsible: document.querySelector('[data-point="1"][data-field="responsible"]').value,
            vote: document.querySelector('[data-point="0"][data-vote-result]').value,
            legacyTask: !!document.querySelector('[data-point="0"][data-task="0"][data-field="description"]'),
            legacyAdd: !!document.querySelector('[data-action="add-task"][data-index="0"]'),
            openAvailable: !!document.querySelector('[data-action="open-protocol"]') };
        })()`);
        assert.match(completion.conflict, /auf dem Datenträger geändert/);
        assert.doesNotMatch(completion.conflict, /Error invoking remote method/);
        assert.ok(completion.stillOpen);
        assert.ok(completion.empty);
        assert.equal(completion.contentOverflows, false, 'Meeting editor should fit at the minimum window width');
        assert.ok(completion.checked);
        assert.equal(completion.responsible, 'TOP Leitung & Team');
        assert.equal(completion.vote, 'accepted');
        assert.ok(completion.legacyTask);
        assert.equal(completion.legacyAdd, false);
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
        assert.deepEqual(pdfColors, ['rgb(65, 43, 21)', 'rgb(65, 43, 21)', 'rgb(65, 43, 21)', 'rgb(36, 41, 47)']);
        assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), {
          folder: data, protocolCss: null, modules: { meetings: true, members: true, invoices: true, letters: true }, lastSeenVersion: app.getVersion()
        });
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
          points: ['discussion', 'decision', 'info'].map((type, i) => ({
            type, headline: 'LangeÜberschrift'.repeat(12), details: 'Details', tasks: [],
            ...(i === 1 ? { vote: { result: 'accepted', yes: 5, no: 1, abstain: 0 } } : {})
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
          const voteStyles = await layoutWindow.webContents.executeJavaScript(`(() => {
            const badge = document.querySelector('.vote-badge');
            const result = {};
            for (const type of ['accepted', 'unanimous_accepted', 'rejected', 'unanimous_rejected', 'other']) {
              badge.dataset.result = type;
              const style = getComputedStyle(badge);
              result[type] = { background: style.backgroundColor, radius: style.borderTopLeftRadius };
            }
            badge.dataset.result = 'accepted';
            return result;
          })()`);
          assert.equal(voteStyles.unanimous_accepted.background, 'rgb(217, 243, 227)');
          assert.equal(voteStyles.unanimous_rejected.background, 'rgb(253, 225, 225)');
          assert.equal(voteStyles.accepted.background, 'rgb(255, 240, 207)');
          assert.equal(voteStyles.rejected.background, voteStyles.accepted.background);
          assert.equal(voteStyles.other.background, 'rgb(255, 240, 207)');
          assert.ok(parseFloat(voteStyles.accepted.radius) > 0);
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
