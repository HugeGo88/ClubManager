const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
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
  const secondData = path.join(root, 'second-club');
  const cssFile = path.join(root, 'custom.css');
  const templateFile = path.join(root, 'meeting.html');
  const letterTemplateFile = path.join(root, 'letter.html');
  const signaturePng = path.join(root, 'signature.png');
  const signatureSvg = path.join(root, 'signature.svg');
  let selectedSignature = signaturePng;
  let selectedDataFolder = data;
  await fs.writeFile(cssFile, 'body { color: rgb(12, 34, 56); }');
  await fs.writeFile(templateFile, '<main><h1>Vorlage {{title}}</h1>{{attendance}}{{points}}{{open_tasks}}</main>');
  await fs.writeFile(letterTemplateFile, '<main class="letter"><h1>Briefvorlage {{title}}</h1>{{date}}{{address}}{{content}}{{signatures}}</main>');
  await fs.writeFile(signaturePng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await fs.writeFile(signatureSvg, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path d="M1 15 Q20 0 39 15" fill="none" stroke="black"/></svg>');
  await fs.mkdir(data);
  await fs.mkdir(secondData);
  app.setPath('userData', path.join(root, 'settings'));
  await fs.mkdir(app.getPath('userData'));
  let cancelCssDialog = false;
  dialog.showOpenDialog = async (window, options) => options.properties.includes('openFile')
    ? (options.title === 'Unterschrift auswählen' ? { canceled: false, filePaths: [selectedSignature] }
      : options.title === 'HTML-Vorlage für Briefe auswählen' ? { canceled: false, filePaths: [letterTemplateFile] }
      : options.filters?.[0]?.extensions.includes('html') ? { canceled: false, filePaths: [templateFile] }
      : cancelCssDialog ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [cssFile] })
    : { canceled: false, filePaths: [selectedDataFolder] };
  const pdfColors = [];
  const pdfPointHeadings = [];
  const pdfVoteResults = [];
  const pdfOpenTasks = [];
  const pdfTitles = [];
  const pdfDocuments = [];
  app.on('browser-window-created', (event, window) => {
    if (window.isVisible()) return;
    const printToPDF = window.webContents.printToPDF.bind(window.webContents);
    window.webContents.printToPDF = async options => {
      pdfTitles.push(await window.webContents.executeJavaScript('document.querySelector("main h1")?.textContent'));
      pdfDocuments.push(await window.webContents.executeJavaScript('document.body.innerHTML'));
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
  let splash;
  let splashWasFirstWindow;
  let appWindowCreatedAfterSplashShown;
  app.once('browser-window-created', (event, window) => {
    splash = window;
    splashWasFirstWindow = BrowserWindow.getAllWindows().length === 1;
    window.webContents.once('did-finish-load', async () => {
      try {
        assert.equal(Menu.getApplicationMenu(), null, 'The app has no native application menu');
        assert.equal(splashWasFirstWindow, true, 'The splash is the only window created initially');
        for (let attempt = 0; attempt < 100 && !window.isVisible(); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(window.isVisible(), true, 'The splash screen appears after its page loads');
        assert.match(await window.webContents.executeJavaScript('document.body.textContent'), /ClubManager[\s\S]*Wird gestartet/,
          'The splash screen identifies the app and indicates that it is starting');
      } catch (error) {
        console.error(error);
        clearTimeout(timeout);
        app.exit(1);
      }
    });
  });
  let startupWindowHandled = false;
  app.on('browser-window-created', (event, window) => {
    if (window === splash || startupWindowHandled) return;
    startupWindowHandled = true;
    appWindowCreatedAfterSplashShown = Boolean(splash && splash.isVisible());
    window.webContents.once('did-finish-load', async () => {
      try {
        assert.equal(appWindowCreatedAfterSplashShown, true, 'The splash appears before the app window is created');
        assert.equal(app.commandLine.getSwitchValue('lang'), 'de-DE',
          'Chromium uses the German locale for native date controls');
        assert.equal(window.isVisible(), false, 'The app window stays hidden until its first render is ready');
        assert.ok(splash && splash.isVisible(), 'The splash screen remains visible while the app initializes');
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
          const sectionedEntry = [...document.querySelectorAll('main .card')].find(card =>
            card.querySelector('h2')?.textContent === 'Version 0.1.5');
          const sectionTitles = [...sectionedEntry.querySelectorAll('h3')].map(heading => heading.textContent);
          if (sectionTitles.join('|') !== 'Allgemein|Sitzungen|Briefe' ||
              !sectionedEntry.querySelector('ul li') ||
              ![...document.querySelectorAll('main .card')].some(card =>
                card.querySelector('h2')?.textContent === 'Version 0.1.4' && card.querySelector('ul li'))) {
            throw new Error('Current release sections and legacy release notes must be displayed');
          }
        })()`);
        for (let attempt = 0; attempt < 100 && !window.isVisible(); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(window.isVisible(), true, 'The app window appears after the first render');
        assert.equal(splash.isDestroyed(), true, 'The splash screen closes after the app window appears');
        await window.webContents.executeJavaScript(`(async () => {
          const button = document.querySelector('[data-action="toggle-sidebar"]');
          const sidebar = document.querySelector('.activity');
          if (button.getAttribute('aria-pressed') !== 'false' || sidebar.getBoundingClientRect().width !== 190) throw new Error('Sidebar must default to expanded');
          const font = await document.fonts.load('24px "Material Icons"');
          if (!font.length || !document.fonts.check('24px "Material Icons"')) throw new Error('Local Material Icons font did not load');
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          context.font = '24px "Material Icons"';
          for (const nav of document.querySelectorAll('.activity [data-view]')) {
            const icon = nav.querySelector('.nav-icon');
            if (!icon.classList.contains('material-icons') || context.measureText(icon.textContent).width > 30 ||
                nav.hasAttribute('title')) throw new Error('Missing Material icon or unexpected expanded tooltip for ' + nav.dataset.view);
          }
          const iconColor = view => getComputedStyle(document.querySelector('[data-view="' + view + '"] .nav-icon')).color;
          if (new Set(['meetings', 'members', 'invoices', 'letters'].map(iconColor)).size !== 4 ||
              !['tasks', 'decisions', 'tops', 'statistics'].every(view => iconColor(view) === iconColor('meetings'))) {
            throw new Error('Module colors must distinguish groups and match their submodules');
          }
          button.focus();
          button.click();
          for (let i = 0; i < 200 && button.getAttribute('aria-pressed') !== 'true'; i++) await new Promise(resolve => setTimeout(resolve, 25));
          const animations = sidebar.getAnimations().filter(animation => animation.transitionProperty === 'width');
          if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !animations.length) throw new Error('Sidebar width should animate');
          await Promise.all(animations.map(animation => animation.finished));
          if (sidebar.getBoundingClientRect().width !== 58 ||
              getComputedStyle(document.querySelector('[data-view="meetings"] .nav-label')).visibility !== 'hidden' ||
              getComputedStyle(document.querySelector('[data-view="tasks"] .nav-icon')).display === 'none' ||
              document.activeElement !== button) throw new Error('Collapsed sidebar must show icons, hide labels, and retain focus');
          for (const nav of document.querySelectorAll('.activity [data-view]')) {
            if (nav.title !== nav.getAttribute('aria-label')) throw new Error('Missing collapsed tooltip for ' + nav.dataset.view);
          }
          document.querySelector('[data-view="tasks"]').click();
          for (let i = 0; i < 200 && !document.querySelector('[data-view="tasks"]').classList.contains('active'); i++) await new Promise(resolve => setTimeout(resolve, 25));
          if (!document.querySelector('[data-view="tasks"]').classList.contains('active')) throw new Error('Collapsed navigation must remain usable');
        })()`);
        const sidebarSettingsFile = path.join(app.getPath('userData'), 'settings.json');
        assert.equal(JSON.parse(await fs.readFile(sidebarSettingsFile, 'utf8')).sidebarCollapsed, true);
        await window.webContents.executeJavaScript(`window.club.setModules({ meetings: true, members: false, invoices: false, letters: false })`);
        assert.equal(JSON.parse(await fs.readFile(sidebarSettingsFile, 'utf8')).sidebarCollapsed, true);
        const reloadFinished = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await reloadFinished;
        await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          const sidebarToggle = document.querySelector('[data-action="toggle-sidebar"]');
          if (sidebarToggle.getAttribute('aria-pressed') !== 'true' || document.querySelector('.activity').getBoundingClientRect().width !== 58) throw new Error('Sidebar preference must survive reload');
          sidebarToggle.click();
          for (let i = 0; i < 200 && sidebarToggle.getAttribute('aria-pressed') !== 'false'; i++) await new Promise(resolve => setTimeout(resolve, 25));
          await Promise.all(document.querySelector('.activity').getAnimations().filter(animation => animation.transitionProperty === 'width').map(animation => animation.finished));
          if (sidebarToggle.getAttribute('aria-pressed') !== 'false' || document.querySelector('.activity').getBoundingClientRect().width !== 190 ||
              getComputedStyle(document.querySelector('[data-view="meetings"] .nav-label')).visibility !== 'visible') throw new Error('Sidebar must expand again');
          if ([...document.querySelectorAll('.activity [data-view]')].some(nav => nav.hasAttribute('title'))) throw new Error('Expanded sidebar must not show redundant tooltips');
          if (document.querySelector('main h1')?.textContent === 'Versionsverlauf') throw new Error('Same version must not reopen history');
          const manualButton = document.querySelector('[data-view="manual"]');
          if (manualButton.nextElementSibling?.dataset.view !== 'changelog') throw new Error('Manual must be above the version history');
          manualButton.click();
          for (let i = 0; i < 200 && document.querySelector('main h1')?.textContent !== 'ClubManager-Handbuch'; i++) await new Promise(resolve => setTimeout(resolve, 25));
          if (document.querySelector('main h1')?.textContent !== 'ClubManager-Handbuch' ||
              !document.querySelector('main').textContent.includes('Version ${app.getVersion()}') ||
              !document.querySelector('main').textContent.includes('Erste Schritte und Navigation') ||
              !document.querySelector('main').textContent.includes('Briefe')) throw new Error('Versioned manual must be available without a data folder');
          document.querySelector('[data-view="changelog"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('main h1')?.textContent === 'Versionsverlauf') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Version history must be accessible without a data folder');
        })()`);
        window.webContents.debugger.attach('1.3');
        try {
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
          });
          await window.webContents.executeJavaScript(`(async () => {
            const sidebar = document.querySelector('.activity');
            const button = document.querySelector('[data-action="toggle-sidebar"]');
            if (!matchMedia('(prefers-reduced-motion: reduce)').matches) throw new Error('Reduced motion emulation failed');
            for (const [collapsed, width] of [[true, 58], [false, 190]]) {
              button.click();
              for (let i = 0; i < 200 && button.getAttribute('aria-pressed') !== String(collapsed); i++) {
                await new Promise(resolve => setTimeout(resolve, 25));
              }
              if (button.getAttribute('aria-pressed') !== String(collapsed) || sidebar.getBoundingClientRect().width !== width ||
                  sidebar.getAnimations().some(animation => animation.transitionProperty === 'width')) throw new Error('Reduced motion must disable sidebar animation');
            }
          })()`);
        } finally {
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
          window.webContents.debugger.detach();
        }
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
          dataFolders: [], activeFolder: null, protocolCss: cssFile, meetingTemplate: null, letterTemplate: null, signatures: [], modules: { meetings: true, members: true, invoices: true, letters: true }, sidebarCollapsed: false, lastSeenVersion: app.getVersion()
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
          const sidebarToggle = document.querySelector('[data-action="toggle-sidebar"]');
          sidebarToggle.click();
          await waitFor(() => sidebarToggle.getAttribute('aria-pressed') === 'true');
          if (document.querySelector('[data-markdown-editor="0"] .cm-editor') !== dirtyEditor ||
              document.querySelector('[data-field="title"]').value !== 'Beispiel: Vorstandssitzung') throw new Error('Sidebar toggle must preserve unsaved editor state');
          sidebarToggle.click();
          await waitFor(() => sidebarToggle.getAttribute('aria-pressed') === 'false');
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
          const meetingSearch = document.querySelector('[data-list-search="meetings"]');
          const searchMeetings = value => {
            meetingSearch.value = value;
            meetingSearch.dispatchEvent(new Event('input', { bubbles: true }));
          };
          searchMeetings('VORSTANDS');
          if (document.querySelectorAll('[data-list-results] [data-action="select"]').length !== 1) throw new Error('Meeting title search failed');
          searchMeetings('nicht vorhanden');
          if (!document.querySelector('[data-list-results]').textContent.includes('Keine Sitzungen entsprechen der Suche.')) throw new Error('Meeting no-results message missing');
          if (document.querySelector('[data-field="title"]') !== title || title.value !== 'Beispiel: Vorstandssitzung aktualisiert' ||
              !document.querySelector('.status').textContent.includes('Ungespeicherte')) throw new Error('Meeting search changed the dirty editor');
          const meetingDate = document.querySelector('[data-field="date"]').value;
          searchMeetings(meetingDate);
          if (!document.querySelector('[data-list-results] [data-action="select"]')) throw new Error('Meeting ISO date search failed');
          searchMeetings('');
          if (!document.querySelector('[data-list-results] .selected')) throw new Error('Meeting selection lost after clearing search');
          title.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
          await waitFor(() => document.querySelector('[role="status"]')?.textContent.includes('Sitzung gespeichert'));
          await click('[data-action="export"]');
          const notice = await waitFor(() => {
            const text = document.querySelector('[role="status"]')?.textContent;
            return text?.includes('PDF gespeichert') && text;
          });
          await waitFor(() => document.querySelector('[data-action="open-protocol"]'));
          const previewButton = document.querySelector('[data-action="toggle-preview"]');
          if (!previewButton?.querySelector('svg') || previewButton.getAttribute('aria-label') !== 'PDF-Vorschau öffnen') {
            throw new Error('PDF preview control should be a compact, accessible icon button');
          }
          const buttonRect = previewButton.getBoundingClientRect();
          const stageRect = document.querySelector('.meeting-stage').getBoundingClientRect();
          if (Math.abs(buttonRect.right - stageRect.right) > 16 || Math.abs(buttonRect.top - stageRect.top) > 16 ||
              previewButton.closest('.meeting-actions')) {
            throw new Error('PDF preview icon must sit in the meeting view’s upper-right corner, outside the action row');
          }
          await click('[data-action="toggle-preview"]');
          await waitFor(() => document.querySelector('.preview-pane iframe'));
          if (document.querySelector('[data-action="toggle-preview"]').getAttribute('aria-pressed') !== 'true') {
            throw new Error('PDF preview icon button should expose its open state');
          }
          const splitter = document.querySelector('[data-preview-splitter]');
          if (!splitter || !document.querySelector('.preview-pane iframe').src.startsWith('blob:')) {
            throw new Error('Saved meeting PDF preview did not open');
          }
          const previewWidth = Number(splitter.getAttribute('aria-valuenow'));
          splitter.focus();
          splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
          if (Number(splitter.getAttribute('aria-valuenow')) <= previewWidth) {
            throw new Error('PDF preview splitter did not resize with the keyboard');
          }
          await click('[data-action="close-preview"]');
          if (document.querySelector('.preview-pane')) throw new Error('PDF preview did not close');
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
        assert.deepEqual(result.navigation, ['Sitzungen', 'Offene Aufgaben', 'Entscheidungen', 'Alle TOPs', 'Statistiken', 'Mitglieder', 'Rechnungen', 'Briefe', 'Handbuch', 'Versionsverlauf', 'Einstellungen']);
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
          dataFolders: [{ path: data, name: 'data' }], activeFolder: data, protocolCss: cssFile, meetingTemplate: null, letterTemplate: null, signatures: [], modules: { meetings: true, members: true, invoices: true, letters: true }, sidebarCollapsed: false, lastSeenVersion: app.getVersion()
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
          const search = document.querySelector('[data-list-search="meetings"]');
          search.value = 'andere';
          search.dispatchEvent(new Event('input', { bubbles: true }));
          if (document.querySelectorAll('[data-list-results] [data-action="select"]').length !== 4 ||
              document.querySelector('[data-action="select"][data-id="${saved.meeting.id}"]')) throw new Error('Meeting search must filter multiple records');
          search.value = '';
          search.dispatchEvent(new Event('input', { bubbles: true }));
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
        const detailFixture = structuredClone(saved);
        detailFixture.meeting.id = randomUUID();
        detailFixture.meeting.title = 'Aufgaben Detailtest';
        detailFixture.meeting.points = [
          { headline: 'Gemeinsamer TOP', type: 'info', details: 'Details <img src=x> prüfen\nZweite Zeile', tasks: [
            { description: 'Detailaufgabe A', responsible: '', done: false },
            { description: 'Detailaufgabe B', responsible: '', done: false }
          ] },
          { headline: 'Leerer TOP', type: 'discussion', details: '', tasks: [
            { description: 'Detailaufgabe C', responsible: '', done: false }
          ] }
        ];
        const detailFile = path.join(meetingsDir, `${detailFixture.meeting.id}.json`);
        await fs.writeFile(detailFile, JSON.stringify(detailFixture, null, 2) + '\n');
        try {
          await window.webContents.executeJavaScript(`(async () => {
            const waitFor = async test => {
              for (let i = 0; i < 200; i++) {
                if (test()) return;
                await new Promise(resolve => setTimeout(resolve, 25));
              }
              throw new Error('Timed out waiting for task details');
            };
            const click = async selector => {
              document.querySelector(selector).click();
              await waitFor(() => !document.body.inert);
            };
            await click('[data-action="refresh-tasks"]');
            const search = document.querySelector('[data-task-filter="search"]');
            search.value = 'Aufgaben Detailtest';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const buttons = () => [...document.querySelectorAll('[data-action="toggle-task-details"]')];
            if (buttons().length !== 3 || document.querySelector('.top-details-row')) throw new Error('Task details must initially be collapsed');
            if (new Set(buttons().map(button => button.getAttribute('aria-controls'))).size !== 3) throw new Error('Task detail IDs must be unique');
            await click('[data-action="toggle-task-details"][data-index="0"][data-task-index="0"]');
            let first = document.querySelector('[data-action="toggle-task-details"][data-index="0"][data-task-index="0"]');
            let row = first.closest('tr').nextElementSibling;
            if (first.getAttribute('aria-expanded') !== 'true' || document.activeElement !== first ||
                row.cells[0].colSpan !== 9 || row.querySelector('.top-details-content')?.id !== first.getAttribute('aria-controls') ||
                row.querySelector('.top-details-content')?.textContent !== 'Details <img src=x> prüfen\\nZweite Zeile' ||
                row.querySelector('img')) throw new Error('Task TOP details were not safely expanded');
            await click('[data-action="toggle-task-details"][data-index="0"][data-task-index="1"]');
            if (document.querySelectorAll('.top-details-row').length !== 1 ||
                document.querySelector('[data-action="toggle-task-details"][data-index="0"][data-task-index="0"]').getAttribute('aria-expanded') !== 'false' ||
                document.querySelector('[data-action="toggle-task-details"][data-index="0"][data-task-index="1"]').getAttribute('aria-expanded') !== 'true') {
              throw new Error('Each task must have an independent detail toggle');
            }
            await click('[data-sort="description"]');
            if (document.querySelector('[data-action="toggle-task-details"][data-index="0"][data-task-index="1"]').getAttribute('aria-expanded') !== 'true') throw new Error('Sorting must preserve expanded task');
            search.value = 'Detailaufgabe B';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            if (!document.querySelector('.top-details-row')) throw new Error('Filtering must preserve matching task details');
            search.value = 'Aufgaben Detailtest';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await click('[data-action="toggle-task-details"][data-index="1"][data-task-index="0"]');
            if (document.querySelector('.top-details-content')?.textContent !== 'Keine Details vorhanden.') throw new Error('Missing TOP detail fallback');
            await click('[data-action="toggle-task-details"][data-index="1"][data-task-index="0"]');
            if (document.querySelector('.top-details-row')) throw new Error('Task details must collapse');
            await click('[data-action="toggle-task-details"][data-index="0"][data-task-index="0"]');
            document.querySelector('[data-complete-task][data-point-index="0"][data-task-index="0"]').click();
            await waitFor(() => document.querySelector('.notice')?.textContent === 'Aufgabe als erledigt markiert.');
            if (document.querySelector('.top-details-row') || document.querySelectorAll('[data-task-row]').length !== 2) throw new Error('Completing expanded task must remove its details');
            await click('[data-action="toggle-task-details"][data-index="0"][data-task-index="1"]');
            await click('[data-action="refresh-tasks"]');
            if (document.querySelector('.top-details-row')) throw new Error('Reload must clear stale task details');
            await click('[data-action="clear-task-filters"]');
          })()`);
        } finally {
          await fs.unlink(detailFile);
        }
        const badgeFixture = structuredClone(saved);
        badgeFixture.meeting.id = randomUUID();
        badgeFixture.meeting.title = 'Badge Test';
        const badgeNow = new Date();
        const badgeToday = [badgeNow.getFullYear(), String(badgeNow.getMonth() + 1).padStart(2, '0'), String(badgeNow.getDate()).padStart(2, '0')].join('-');
        badgeFixture.meeting.points = [{ headline: 'Badge TOP', type: 'info', details: 'Badge Details', tasks: [
          { description: 'Überfällig A', responsible: 'Alex', done: false, dueDate: '2000-01-01' },
          { description: 'Heute fällig', responsible: 'Alex', done: false, dueDate: badgeToday },
          { description: 'Bereits erledigt', responsible: 'Sam', done: true, dueDate: '2000-01-01', completedDate: '2000-01-02' }
        ] }];
        const badgeFile = path.join(meetingsDir, `${badgeFixture.meeting.id}.json`);
        await fs.writeFile(badgeFile, JSON.stringify(badgeFixture));
        try {
          await window.webContents.executeJavaScript(`(async () => {
            const waitFor = async test => {
              for (let i = 0; i < 200; i++) {
                if (test()) return;
                await new Promise(resolve => setTimeout(resolve, 25));
              }
              throw new Error('Timed out testing overdue badge and completed tasks');
            };
            const badge = () => document.querySelector('[data-overdue-badge]');
            const clickAndWait = async selector => {
              document.querySelector(selector).click();
              await waitFor(() => !document.body.inert);
            };
            await clickAndWait('[data-action="refresh-tasks"]');
            if (badge().hidden || badge().textContent !== '2' ||
                !document.querySelector('[data-view="tasks"]').getAttribute('aria-label').includes('2 überfällig')) throw new Error('Badge must count all saved overdue open tasks');
            const search = document.querySelector('[data-task-filter="search"]');
            search.value = 'Badge Test';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const group = name => document.querySelector('[data-task-group="' + name + '"]');
            if (badge().textContent !== '2' || !group('overdue')?.textContent.includes('Überfällig A') ||
                !group('other')?.textContent.includes('Heute fällig') ||
                document.querySelector('#task-results').textContent.includes('Bereits erledigt') ||
                group('overdue').compareDocumentPosition(group('other')) !== Node.DOCUMENT_POSITION_FOLLOWING) {
              throw new Error('Overdue and non-overdue open tasks must be separated without filtering the badge');
            }
            document.querySelector('[data-show-completed]').click();
            if (!group('other')?.textContent.includes('Bereits erledigt') ||
                group('overdue').textContent.includes('Bereits erledigt') ||
                !group('other').querySelector('[data-complete-task]:checked')) throw new Error('Completed overdue task belongs in the other table');
            const task = index => document.querySelector('[data-complete-task][data-id="${badgeFixture.meeting.id}"][data-task-index="' + index + '"]');
            task(0).click();
            await waitFor(() => document.querySelector('.notice')?.textContent === 'Aufgabe als erledigt markiert.');
            if (badge().textContent !== '1' || !group('other').textContent.includes('Überfällig A') || !task(0).checked) throw new Error('Completing overdue task must update badge and move row');
            task(0).click();
            await waitFor(() => document.querySelector('.notice')?.textContent === 'Aufgabe wieder geöffnet.');
            if (badge().textContent !== '2' || !group('overdue').textContent.includes('Überfällig A') || task(0).checked) throw new Error('Reopening overdue task must update badge and move row');
            document.querySelector('[data-show-completed]').click();
            if (document.querySelector('#task-results').textContent.includes('Bereits erledigt')) throw new Error('Completed tasks should be hidden again');
            await clickAndWait('[data-action="clear-task-filters"]');
            const RealDate = Date;
            const nextDay = new RealDate();
            nextDay.setDate(nextDay.getDate() + 1);
            class Tomorrow extends RealDate {
              constructor(...args) { super(...(args.length ? args : [nextDay.getTime()])); }
              static now() { return nextDay.getTime(); }
            }
            try {
              window.Date = Tomorrow;
              document.dispatchEvent(new Event('visibilitychange'));
              if (badge().textContent !== '3' || !group('overdue').textContent.includes('Heute fällig')) throw new Error('Badge and overdue table must update on a new local day');
            } finally {
              window.Date = RealDate;
              document.dispatchEvent(new Event('visibilitychange'));
            }
            if (badge().textContent !== '2') throw new Error('Badge must restore after local day changes back');
          })()`);
          const reopened = JSON.parse(await fs.readFile(badgeFile, 'utf8')).meeting.points[0].tasks[0];
          assert.equal(reopened.done, false);
          assert.equal(reopened.completedDate, undefined);
        } finally {
          await fs.unlink(badgeFile);
        }
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
        assert.ok(table.columnWidths[7] >= 120, 'Deadline column should remain readable');
        assert.ok(table.scrollAtEnd > 0);
        assert.equal(table.scrollAfterSort, table.scrollAtEnd);
        assert.equal(table.scrollAfterFilter, 0, 'A different table starts at its own scroll position');
        assert.deepEqual(table.ascending, ['Veranstaltungsort kontaktieren', 'Budget prüfen']);
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
          if (!document.querySelector('[data-overdue-badge]').hidden ||
              document.querySelector('[data-view="tasks"]').getAttribute('aria-label') !== 'Offene Aufgaben') throw new Error('Empty overdue badge must be hidden');
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
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out testing read-only protocol');
          };
          document.querySelector('[data-meeting-read-only]').click();
          if (!document.querySelector('[data-field="title"]').disabled ||
              !document.querySelector('[data-person="0"][data-field="name"]').disabled ||
              !document.querySelector('[data-point="0"][data-vote-result]').disabled ||
              !document.querySelector('[data-action="add-point"]').disabled ||
              !document.querySelector('[data-point="1"][data-task="0"][data-field="description"]').disabled ||
              document.querySelector('[data-point="1"][data-task="0"][data-field="done"]').disabled ||
              document.querySelector('[data-markdown-editor="0"] .cm-content').getAttribute('contenteditable') !== 'false' ||
              !document.querySelector('[data-markdown-editor="0"] .markdown-format').disabled ||
              !document.querySelector('.markdown-task') ||
              [...document.querySelectorAll('.markdown-task')].some(task => !task.disabled)) {
            throw new Error('Read-only protocol must block editing, but allow task status changes');
          }
          const task = document.querySelector('[data-point="1"][data-task="0"][data-field="done"]');
          task.click();
          document.querySelector('[data-action="save"]').click();
          await waitFor(() => !task.isConnected && document.querySelector('.notice')?.textContent === 'Sitzung gespeichert.');
          document.querySelector('[data-view="tasks"]').click();
          const overviewTask = await waitFor(() => document.querySelector('[data-complete-task][data-id="${saved.meeting.id}"][data-point-index="1"][data-task-index="0"]'));
          overviewTask.click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Aufgabe als erledigt markiert.');
          document.querySelector('[data-view="meetings"]').click();
          const select = await waitFor(() => document.querySelector('[data-action="select"][data-id="${saved.meeting.id}"]'));
          select.click();
          await waitFor(() => document.querySelector('[data-meeting-read-only]')?.checked);
          if (!document.querySelector('[data-point="1"][data-task="0"][data-field="done"]').checked) {
            throw new Error('Task completion in the overview must persist on a read-only protocol');
          }
          const originalConfirm = window.confirm;
          let confirmations = 0;
          try {
            window.confirm = () => { confirmations++; return false; };
            document.querySelector('[data-meeting-read-only]').click();
            if (!document.querySelector('[data-meeting-read-only]').checked ||
                !document.querySelector('[data-field="title"]').disabled) throw new Error('Cancelling unlock must retain protection');
            window.confirm = () => { confirmations++; return true; };
            document.querySelector('[data-meeting-read-only]').click();
            if (document.querySelector('[data-meeting-read-only]').checked ||
                document.querySelector('[data-field="title"]').disabled ||
                document.querySelector('[data-markdown-editor="0"] .cm-content').getAttribute('contenteditable') !== 'true' ||
                confirmations !== 2) throw new Error('Confirming unlock must restore editing');
          } finally {
            window.confirm = originalConfirm;
          }
          const unlock = document.querySelector('[data-meeting-read-only]');
          document.querySelector('[data-action="save"]').click();
          await waitFor(() => !unlock.isConnected && document.querySelector('.notice')?.textContent === 'Sitzung gespeichert.');
        })()`);
        const unlocked = JSON.parse(await fs.readFile(path.join(meetingsDir, jsonFile), 'utf8'));
        assert.equal(unlocked.meeting.readOnly, false);
        assert.equal(unlocked.meeting.points[1].tasks[0].done, true);
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
          dataFolders: [{ path: data, name: 'data' }], activeFolder: data, protocolCss: null, meetingTemplate: null, letterTemplate: null, signatures: [], modules: { meetings: true, members: true, invoices: true, letters: true }, sidebarCollapsed: false, lastSeenVersion: app.getVersion()
        });
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Meeting template selection timed out');
          };
          document.querySelector('[data-view="settings"]').click();
          await waitFor(() => document.querySelector('[data-settings-tab="meetings"]'));
          document.querySelector('[data-settings-tab="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="choose-meeting-template"]'));
          document.querySelector('[data-action="choose-meeting-template"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-meeting-template"]'));
        })()`);
        assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).meetingTemplate, templateFile);
        await fs.writeFile(cssFile, 'body { color: rgb(10, 20, 30); }');
        await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-settings-tab="general"]').click();
          for (let i = 0; i < 200 && !document.querySelector('[data-action="choose-protocol-css"]'); i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          document.querySelector('[data-action="choose-protocol-css"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('[data-action="reset-protocol-css"]')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Shared CSS selection timed out');
        })()`);
        assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).meetingTemplate, templateFile);
        const reloadTemplate = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await reloadTemplate;
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Custom template export timed out');
          };
          await waitFor(() => document.querySelector('#app')?.dataset.modulesLoaded === 'true');
          document.querySelector('[data-view="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="select"]'));
          document.querySelector('[data-action="select"]').click();
          await waitFor(() => document.querySelector('[data-action="export"]'));
          document.querySelector('[data-action="export"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.match(pdfTitles.at(-1), /^Vorlage Beispiel:/);
        assert.equal(pdfColors.at(-1), 'rgb(10, 20, 30)');
        await fs.writeFile(templateFile, '<main><h1>Aktualisiert {{title}}</h1>{{points}}</main>');
        await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="export"]').click();
          for (let i = 0; i < 200; i++) {
            if (!document.body.inert && document.querySelector('.notice')?.textContent.includes('PDF gespeichert')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Updated template export timed out');
        })()`);
        assert.match(pdfTitles.at(-1), /^Aktualisiert Beispiel:/);
        await fs.unlink(templateFile);
        await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="export"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('.notice.error')?.textContent.includes('HTML-Vorlage')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Missing template error was not shown');
        })()`);
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Meeting template reset timed out');
          };
          document.querySelector('[data-view="settings"]').click();
          await waitFor(() => document.querySelector('[data-settings-tab="meetings"]'));
          document.querySelector('[data-settings-tab="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-meeting-template"]'));
          document.querySelector('[data-action="reset-meeting-template"]').click();
          await waitFor(() => document.querySelector('[data-meeting-template]')?.textContent.includes('Standardvorlage'));
          document.querySelector('[data-view="meetings"]').click();
          await waitFor(() => document.querySelector('[data-action="select"]'));
          document.querySelector('[data-action="select"]').click();
          await waitFor(() => document.querySelector('[data-action="export"]'));
          document.querySelector('[data-action="export"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).meetingTemplate, null);
        assert.match(pdfTitles.at(-1), /^Beispiel:/);
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
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = test();
              if (value) return value;
              if (document.querySelector('.notice.error')) throw new Error(document.querySelector('.notice.error').textContent);
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Letter settings timed out');
          };
          document.querySelector('[data-view="settings"]').click();
          await waitFor(() => document.querySelector('[data-settings-tab="letters"]'));
          document.querySelector('[data-settings-tab="letters"]').click();
          await waitFor(() => document.querySelector('[data-action="choose-signature"]'));
          document.querySelector('[data-action="choose-signature"]').click();
          await waitFor(() => document.querySelectorAll('[data-action="remove-signature"]').length === 1);
        })()`);
        selectedSignature = signatureSvg;
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              if (test()) return;
              if (document.querySelector('.notice.error')) throw new Error(document.querySelector('.notice.error').textContent);
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Letter setup timed out');
          };
          document.querySelector('[data-action="choose-signature"]').click();
          await waitFor(() => document.querySelectorAll('[data-action="remove-signature"]').length === 2);
          document.querySelector('[data-action="choose-letter-template"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-letter-template"]'));
          document.querySelector('[data-view="letters"]').click();
          await waitFor(() => document.querySelector('[data-action="new-letter"]'));
          document.querySelector('[data-action="new-letter"]').click();
          await waitFor(() => document.querySelector('[data-letter-field="title"]'));
          if (!document.querySelector('[data-letter-address]').hidden) throw new Error('Address fields should initially be hidden');
          const title = document.querySelector('[data-letter-field="title"]');
          title.value = 'Testbrief';
          title.dispatchEvent(new Event('input', { bubbles: true }));
          const confirm = window.confirm;
          window.confirm = () => false;
          try {
            document.querySelector('[data-view="manual"]').click();
            await waitFor(() => !document.body.inert);
            if (document.querySelector('[data-letter-field="title"]')?.value !== 'Testbrief' ||
                !document.querySelector('.status').textContent.includes('Ungespeicherte')) throw new Error('Manual navigation must honor unsaved changes');
          } finally {
            window.confirm = confirm;
          }
          const editor = document.querySelector('[data-letter-editor] .cm-content');
          editor.focus();
          document.execCommand('insertText', false, '**Briefinhalt**');
          await waitFor(() => editor.textContent.includes('Briefinhalt'));
          document.querySelector('[data-action="save-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Brief gespeichert.');
          document.querySelector('[data-action="export-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.match(pdfDocuments.at(-1), /Briefvorlage Testbrief/);
        assert.match(pdfDocuments.at(-1), /<strong>Briefinhalt<\/strong>/);
        assert.doesNotMatch(pdfDocuments.at(-1), /class="letter-address"|class="letter-signature"/);
        const reloadLetters = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await reloadLetters;
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              if (test()) return;
              if (document.querySelector('.notice.error')) throw new Error(document.querySelector('.notice.error').textContent);
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Letter reload timed out');
          };
          await waitFor(() => document.querySelector('#app')?.dataset.modulesLoaded === 'true');
          document.querySelector('[data-view="letters"]').click();
          await waitFor(() => document.querySelector('[data-action="select-letter"]'));
          document.querySelector('[data-action="select-letter"]').click();
          await waitFor(() => document.querySelector('[data-letter-field="title"]')?.value === 'Testbrief');
          const addressToggle = document.querySelector('[data-letter-field="includeAddress"]');
          addressToggle.click();
          const addressFields = document.querySelector('[data-letter-address]');
          if (addressFields.hidden) throw new Error('Address fields did not open');
          for (const [field, value] of Object.entries({ company: 'Beispielfirma', name: 'Alex Beispiel', street: 'Hauptstraße 1', postalCode: '01234', city: 'Musterstadt' })) {
            const input = document.querySelector('[data-letter-address-field="' + field + '"]');
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          addressToggle.click();
          if (!addressFields.hidden) throw new Error('Address fields did not hide');
          addressToggle.click();
          if (addressFields.hidden || document.querySelector('[data-letter-address-field="postalCode"]').value !== '01234') throw new Error('Address fields were not restored');
          const letterSearch = document.querySelector('[data-list-search="letters"]');
          const searchLetters = value => {
            letterSearch.value = value;
            letterSearch.dispatchEvent(new Event('input', { bubbles: true }));
          };
          searchLetters('TESTBRIEF');
          if (document.querySelectorAll('[data-list-results] [data-action="select-letter"]').length !== 1) throw new Error('Letter title search failed');
          searchLetters('nicht vorhanden');
          if (!document.querySelector('[data-list-results]').textContent.includes('Keine Briefe entsprechen der Suche.')) throw new Error('Letter no-results message missing');
          if (document.querySelector('[data-letter-address]') !== addressFields ||
              document.querySelector('[data-letter-address-field="postalCode"]').value !== '01234' ||
              !document.querySelector('.status').textContent.includes('Ungespeicherte')) throw new Error('Letter search changed the dirty editor');
          const letterDate = document.querySelector('[data-letter-field="date"]').value.split('-').reverse().join('.');
          searchLetters(letterDate);
          if (!document.querySelector('[data-list-results] [data-action="select-letter"]')) throw new Error('Letter formatted date search failed');
          searchLetters('');
          if (!document.querySelector('[data-list-results] .selected')) throw new Error('Letter selection lost after clearing search');
          for (const checkbox of document.querySelectorAll('[data-letter-signature]')) checkbox.click();
          if (document.querySelectorAll('[data-letter-signature]:checked').length !== 2) throw new Error('Multiple signatures not selected');
          document.querySelector('[data-action="save-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Brief gespeichert.');
          document.querySelector('[data-action="export-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.match(pdfDocuments.at(-1), /Beispielfirma<br>Alex Beispiel<br>Hauptstraße 1<br>01234 Musterstadt/);
        assert.equal((pdfDocuments.at(-1).match(/class="letter-signature"/g) || []).length, 2);
        const letterFiles = (await fs.readdir(path.join(data, 'letters'))).filter(name => name.endsWith('.json'));
        assert.equal(letterFiles.length, 1);
        const savedLetter = JSON.parse(await fs.readFile(path.join(data, 'letters', letterFiles[0]), 'utf8')).letter;
        assert.deepEqual(savedLetter.address, { company: 'Beispielfirma', name: 'Alex Beispiel', street: 'Hauptstraße 1', postalCode: '01234', city: 'Musterstadt' });
        assert.equal(savedLetter.signatures.length, 2);
        assert.equal((await fs.readFile(path.join(data, 'letters', 'pdf', `${savedLetter.id}.pdf`))).subarray(0, 5).toString(), '%PDF-');
        await fs.unlink(signatureSvg);
        await window.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-action="export-letter"]').click();
          for (let i = 0; i < 200; i++) {
            if (document.querySelector('.notice.error')?.textContent.includes('Unterschrift')) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Missing signature error not shown');
        })()`);
        openError = '';
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              if (test()) return;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Letter reset and shared CSS timed out');
          };
          const signatures = [...document.querySelectorAll('[data-letter-signature]')];
          signatures[1].click();
          document.querySelector('[data-action="save-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent === 'Brief gespeichert.');
          document.querySelector('[data-action="open-letter-pdf"]').click();
          await waitFor(() => !document.body.inert);
          document.querySelector('[data-view="settings"]').click();
          await waitFor(() => document.querySelector('[data-settings-tab="letters"]'));
          document.querySelector('[data-settings-tab="letters"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-letter-template"]'));
          document.querySelector('[data-action="reset-letter-template"]').click();
          await waitFor(() => document.querySelector('[data-letter-template]')?.textContent.includes('Standardvorlage'));
          document.querySelector('[data-settings-tab="general"]').click();
          await waitFor(() => document.querySelector('[data-action="choose-protocol-css"]'));
          document.querySelector('[data-action="choose-protocol-css"]').click();
          await waitFor(() => document.querySelector('[data-action="reset-protocol-css"]'));
          document.querySelector('[data-view="letters"]').click();
          await waitFor(() => document.querySelector('[data-action="select-letter"]'));
          document.querySelector('[data-action="select-letter"]').click();
          await waitFor(() => document.querySelector('[data-action="export-letter"]'));
          for (const [field, value] of Object.entries({ company: 'Beispielfirma', name: 'Alex Beispiel', street: 'Hauptstraße 1', postalCode: '01234', city: 'Musterstadt' })) {
            if (document.querySelector('[data-letter-address-field="' + field + '"]')?.value !== value) throw new Error('Address field not restored: ' + field);
          }
          document.querySelector('[data-action="export-letter"]').click();
          await waitFor(() => document.querySelector('.notice')?.textContent.includes('PDF gespeichert'));
        })()`);
        assert.match(openedPaths.at(-1), new RegExp(`${savedLetter.id}\\.pdf$`));
        assert.match(pdfDocuments.at(-1), /<h1>Testbrief<\/h1>/);
        assert.match(pdfDocuments.at(-1), /Alex Beispiel/);
        assert.equal((pdfDocuments.at(-1).match(/class="letter-signature"/g) || []).length, 1);
        assert.equal(pdfColors.at(-1), 'rgb(10, 20, 30)');
        const finalSettings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
        assert.equal(finalSettings.letterTemplate, null);
        assert.equal(finalSettings.signatures.length, 2);
        selectedDataFolder = secondData;
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 200; i++) {
              const value = await test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for data-folder UI');
          };
          const waitForActiveFolder = folderPath => waitFor(async () =>
            await window.club.getFolder() === folderPath &&
            document.querySelector('[data-folder-switcher]')?.value === folderPath &&
            !document.querySelector('.folder-switch-dialog'));
          const click = async selector => {
            const element = await waitFor(() => !document.body.inert && document.querySelector(selector));
            element.click();
          };
          await click('[data-view="settings"]');
          await click('[data-action="choose-folder"]');
          const secondPath = ${JSON.stringify(secondData)};
          await waitFor(() => document.querySelector('[data-folder-switcher]')?.value === secondPath);
          const switcher = document.querySelector('[data-folder-switcher]');
          const folders = await window.club.getFolders();
          if (folders.dataFolders.length !== 2 || folders.activeFolder !== secondPath) {
            throw new Error('The second folder was not registered and activated');
          }
          const option = [...switcher.options].find(item => item.value === secondPath);
          if (!option || option.textContent !== 'second-club' || option.title !== secondPath) {
            throw new Error('The switcher should show the folder name and full path');
          }
          const nameInput = await waitFor(() => document.querySelector('[data-folder-name]'));
          nameInput.value = 'Verein B';
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await click('[data-action="rename-folder"]');
          await waitFor(() => [...document.querySelector('[data-folder-switcher]').options]
            .some(item => item.value === secondPath && item.textContent === 'Verein B'));
          if ((await window.club.listMeetings()).length || (await window.club.listLetters()).length) {
            throw new Error('The new data folder should not show another folder\\'s records');
          }
          const firstPath = ${JSON.stringify(data)};
          const currentSwitcher = document.querySelector('[data-folder-switcher]');
          currentSwitcher.value = firstPath;
          currentSwitcher.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 200; i++) {
            if (await window.club.getFolder() === firstPath && !document.body.inert) break;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (await window.club.getFolder() !== firstPath ||
              !(await window.club.listMeetings()).length || !(await window.club.listLetters()).length) {
            throw new Error('Switching back should restore the first folder and its records');
          }
          const firstOption = [...document.querySelector('[data-folder-switcher]').options]
            .find(item => item.value === firstPath);
          if (firstOption.textContent !== 'data') throw new Error('The first folder display name changed unexpectedly');
          await click('[data-view="meetings"]');
          const firstMeeting = (await window.club.listMeetings())[0]?.meeting;
          if (!firstMeeting) throw new Error('The first folder should contain a saved meeting for switch confirmation tests');
          const selectMeeting = async () => {
            const button = await waitFor(() => [...document.querySelectorAll('[data-action="select"]')]
              .find(item => item.dataset.id === firstMeeting.id));
            button.click();
            return waitFor(() => document.querySelector('[data-field="title"]'));
          };
          const chooseFolder = async (folderPath, choice) => {
            const selector = document.querySelector('[data-folder-switcher]');
            selector.value = folderPath;
            selector.dispatchEvent(new Event('change', { bubbles: true }));
            const dialog = await waitFor(() => document.querySelector('.folder-switch-dialog'));
            dialog.querySelector('[value="' + choice + '"]').click();
          };
          const titleInput = await selectMeeting();
          const originalTitle = titleInput.value;
          const unsavedTitle = originalTitle + ' – ungespeichert';
          titleInput.value = unsavedTitle;
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          await chooseFolder(secondPath, 'cancel');
          await waitFor(() => !document.querySelector('.folder-switch-dialog') &&
            document.querySelector('[data-folder-switcher]')?.value === firstPath);
          if (await window.club.getFolder() !== firstPath ||
              document.querySelector('[data-field="title"]')?.value !== unsavedTitle) {
            throw new Error('Canceling a folder switch must preserve the current folder and draft');
          }
          document.querySelector('[data-field="title"]').value = '';
          document.querySelector('[data-field="title"]').dispatchEvent(new Event('input', { bubbles: true }));
          await chooseFolder(secondPath, 'save');
          await waitFor(() => !document.querySelector('.folder-switch-dialog') && document.querySelector('.notice.error'));
          if (await window.club.getFolder() !== firstPath ||
              document.querySelector('[data-field="title"]')?.value !== '' ||
              !document.querySelector('.status')?.textContent.includes('Ungespeicherte Änderungen')) {
            throw new Error('A failed save must leave the active folder and draft unchanged');
          }
          const discardedTitle = originalTitle + ' – verworfen';
          const invalidTitle = document.querySelector('[data-field="title"]');
          invalidTitle.value = discardedTitle;
          invalidTitle.dispatchEvent(new Event('input', { bubbles: true }));
          await chooseFolder(secondPath, 'discard');
          await waitForActiveFolder(secondPath);
          const secondSwitcher = document.querySelector('[data-folder-switcher]');
          secondSwitcher.value = firstPath;
          secondSwitcher.dispatchEvent(new Event('change', { bubbles: true }));
          await waitForActiveFolder(firstPath);
          const unchangedMeeting = (await window.club.listMeetings()).find(item => item.meeting.id === firstMeeting.id);
          if (unchangedMeeting.meeting.title !== originalTitle) throw new Error('Discarding a draft must not save it');
          const editableMeeting = await selectMeeting();
          const savedTitle = originalTitle + ' – gespeichert';
          editableMeeting.value = savedTitle;
          editableMeeting.dispatchEvent(new Event('input', { bubbles: true }));
          await chooseFolder(secondPath, 'save');
          await waitForActiveFolder(secondPath);
          const returnSwitcher = document.querySelector('[data-folder-switcher]');
          returnSwitcher.value = firstPath;
          returnSwitcher.dispatchEvent(new Event('change', { bubbles: true }));
          await waitForActiveFolder(firstPath);
          const savedMeeting = (await window.club.listMeetings()).find(item => item.meeting.id === firstMeeting.id);
          if (savedMeeting.meeting.title !== savedTitle) throw new Error('Saving a draft must complete before switching folders');
        })()`);
        const folderReloadFinished = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        window.webContents.reload();
        await folderReloadFinished;
        await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          const folders = await window.club.getFolders();
          if (await window.club.getFolder() !== ${JSON.stringify(data)} ||
              document.querySelector('[data-folder-switcher]')?.value !== ${JSON.stringify(data)} ||
              folders.dataFolders.length !== 2 ||
              !folders.dataFolders.some(item => item.path === ${JSON.stringify(secondData)} && item.name === 'Verein B')) {
            throw new Error('The active folder and folder names must survive app reload');
          }
        })()`);
        const folderSettings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
        assert.deepEqual(folderSettings.dataFolders, [
          { path: data, name: 'data' },
          { path: secondData, name: 'Verein B' }
        ]);
        assert.equal(folderSettings.activeFolder, data);
        console.log('Electron smoke test passed: folder switching, dirty-draft decisions, task filtering, conflict recovery, and PDF export.');
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
