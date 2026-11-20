const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function snapshotDirectory(directory, root = directory) {
  const contents = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      contents.push({ path: relativePath, type: 'directory' });
      contents.push(...await snapshotDirectory(fullPath, root));
    } else {
      contents.push({ path: relativePath, type: 'file', contents: await fs.readFile(fullPath, 'base64') });
    }
  }
  return contents.sort((left, right) => left.path.localeCompare(right.path));
}

async function restartScenario(root, mode) {
  const fixture = path.join(root, 'restart-recovery');
  const userData = path.join(fixture, 'settings');
  const folder = path.join(fixture, 'verein');
  app.setVersion(require('../package.json').version);
  if (mode === 'restart-setup') {
    await fs.mkdir(userData, { recursive: true });
    await fs.mkdir(folder);
    await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
      modules: { meetings: true, members: false, invoices: false, letters: false },
      lastSeenVersion: app.getVersion()
    }));
  }
  app.setPath('userData', userData);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  const timeout = setTimeout(() => {
    console.error('Full restart smoke test timed out.');
    app.exit(1);
  }, 20000);
  const mainWindowReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The restart app window did not load.')), 15000);
    app.on('browser-window-created', (event, window) => {
      window.webContents.once('did-finish-load', () => {
        if (!window.webContents.getURL().endsWith('/renderer/index.html')) return;
        clearTimeout(timer);
        resolve(window);
      });
    });
  });
  require('../src/main/main');
  const window = await mainWindowReady;
  await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async test => {
      for (let i = 0; i < 400; i++) {
        if (await test()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for full restart scenario');
    };
    await waitFor(() => document.querySelector('#app')?.dataset.modulesLoaded === 'true');
    if (${JSON.stringify(mode)} === 'restart-setup') {
      document.querySelector('[data-action="choose-folder"]').click();
      await waitFor(async () => await window.club.getFolder() === ${JSON.stringify(folder)} && !document.body.inert);
      document.querySelector('[data-view="settings"]').click();
      await waitFor(() => document.querySelector('[data-settings-tab="letters"]'));
      document.querySelector('[data-settings-tab="letters"]').click();
      await waitFor(() => document.querySelector('[data-module-toggle="letters"]'));
      let toggle = document.querySelector('[data-module-toggle="letters"]');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => !document.body.inert && !document.querySelector('[data-module-view="letters"]').hidden);
      document.querySelector('[data-settings-tab="meetings"]').click();
      await waitFor(() => document.querySelector('[data-module-toggle="meetings"]'));
      toggle = document.querySelector('[data-module-toggle="meetings"]');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => !document.body.inert && document.querySelector('[data-module-nav="meetings"]').hidden);
    } else {
      if (await window.club.getFolder() !== ${JSON.stringify(folder)} ||
          document.querySelector('[data-folder-switcher]').value !== ${JSON.stringify(folder)} ||
          document.querySelector('[data-module-view="letters"]').hidden ||
          !document.querySelector('[data-module-nav="meetings"]').hidden ||
          !document.querySelector('[data-view="letters"]').classList.contains('active')) {
        throw new Error('A full restart must restore the active folder and its visible module selection');
      }
      document.querySelector('[data-view="settings"]').click();
      await waitFor(() => document.querySelector('[data-settings-tab="letters"]'));
      document.querySelector('[data-settings-tab="letters"]').click();
      await waitFor(() => document.querySelector('[data-module-toggle="letters"]'));
      if (!document.querySelector('[data-module-toggle="letters"]').checked ||
          !document.querySelector('main').textContent.includes('verein')) {
        throw new Error('The restored selection must be editable for the named data folder');
      }
    }
  })()`);
  if (mode === 'restart-setup') {
    const savedSettings = JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'));
    assert.deepEqual(savedSettings.modules, { meetings: true, members: false, invoices: false, letters: false },
      'The app-wide migration source must differ from the selected folder modules');
  } else {
    console.log('Electron full restart smoke test passed: same app settings restore the folder-owned selection.');
  }
  clearTimeout(timeout);
  app.quit();
}

async function main() {
  const root = process.env.CLUBMANAGER_SMOKE_ROOT;
  if (!root) throw new Error('CLUBMANAGER_SMOKE_ROOT is required.');

  if (['restart-setup', 'restart-check'].includes(process.env.CLUBMANAGER_RECOVERY_MODE)) {
    await restartScenario(root, process.env.CLUBMANAGER_RECOVERY_MODE);
    return;
  }
  app.setVersion(require('../package.json').version);
  const configurationMode = process.env.CLUBMANAGER_RECOVERY_MODE === 'configuration';
  const fixture = path.join(root, configurationMode ? 'configuration-recovery' : 'folder-recovery');
  const userData = path.join(fixture, 'settings');
  const unavailableFolder = path.join(fixture, 'missing-club');
  const restoredFolder = path.join(fixture, 'restored-club');
  const movedFolder = path.join(fixture, 'moved-club');
  const markerFile = path.join(restoredFolder, 'keep.txt');
  const brokenFolder = path.join(fixture, 'broken-club');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(restoredFolder, { recursive: true });
  await fs.writeFile(markerFile, 'folder contents survive unregister');
  if (configurationMode) {
    await fs.mkdir(brokenFolder);
    await fs.writeFile(path.join(brokenFolder, 'clubmanager-modules.json'), '{');
  }
  app.setPath('userData', userData);

  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    dataFolders: configurationMode
      ? [{ path: brokenFolder, name: 'Kaputt', available: true }]
      : [{ path: unavailableFolder, name: 'Mein Verein', available: true }],
    activeFolder: configurationMode ? brokenFolder : unavailableFolder,
    protocolCss: null,
    meetingTemplate: null,
    letterTemplate: null,
    signatures: [],
    modules: { meetings: true, members: false, invoices: false, letters: false },
    sidebarCollapsed: false,
    lastSeenVersion: app.getVersion()
  }));

  const startupDialogs = [];
  dialog.showMessageBox = async (window, options) => {
    startupDialogs.push(options);
    return { response: 0 };
  };
  let selectedFolder = configurationMode ? path.join(root, 'data') : restoredFolder;
  dialog.showOpenDialog = async (window, options) => {
    if (!options.properties.includes('openDirectory')) {
      throw new Error(`Unexpected folder-recovery dialog: ${options.title}`);
    }
    return { canceled: false, filePaths: [selectedFolder] };
  };

  const timeout = setTimeout(() => {
    console.error('Folder recovery smoke test timed out.');
    app.exit(1);
  }, 25000);

  try {
    const mainWindowReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The app window did not load.')), 20000);
      app.on('browser-window-created', (event, window) => {
        window.webContents.once('did-finish-load', () => {
          if (!window.webContents.getURL().endsWith('/renderer/index.html')) return;
          clearTimeout(timer);
          resolve(window);
        });
      });
    });

    require('../src/main/main');
    const window = await mainWindowReady;
    if (configurationMode) {
      await window.webContents.executeJavaScript(`(async () => {
        const waitFor = async test => {
          for (let i = 0; i < 400; i++) {
            if (await test()) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Timed out waiting for configuration recovery');
        };
        await waitFor(() => document.querySelector('#app')?.dataset.modulesLoaded === 'true');
        if (await window.club.getFolder() !== null || Object.values(await window.club.getModules()).some(Boolean)) {
          throw new Error('Invalid startup configuration must leave folder modules inactive');
        }
        document.querySelector('[data-view="settings"]').click();
        await waitFor(() => document.querySelector('[data-settings-tab="members"]'));
        document.querySelector('[data-settings-tab="members"]').click();
        await waitFor(() => document.querySelector('[data-module-toggle="members"]'));
        if (!document.querySelector('[data-module-toggle="members"]').disabled) throw new Error('Invalid startup configuration must disable controls');
        document.querySelector('[data-action="choose-folder"]').click();
        await waitFor(async () => await window.club.getFolder() === ${JSON.stringify(path.join(root, 'data'))} &&
          !document.body.inert && !document.querySelector('[data-module-toggle="members"]')?.disabled);
        const modules = await window.club.getModules();
        if (!modules.members || !modules.letters) throw new Error('Folder selection must travel to an independent settings context');
        const selector = document.querySelector('[data-folder-switcher]');
        selector.value = ${JSON.stringify(brokenFolder)};
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('.notice.error'));
        if (await window.club.getFolder() !== ${JSON.stringify(path.join(root, 'data'))} ||
            !(await window.club.getModules()).members || document.querySelector('[data-folder-switcher]').value !== ${JSON.stringify(path.join(root, 'data'))}) {
          throw new Error('A failed activation must retain the previous coherent context');
        }
      })()`);
      const modulesFile = path.join(root, 'data', 'clubmanager-modules.json');
      const savedModulesFile = `${modulesFile}.fixture`;
      await fs.rename(modulesFile, savedModulesFile);
      try {
        await fs.mkdir(modulesFile);
        await window.webContents.executeJavaScript(`(async () => {
          const toggle = document.querySelector('[data-module-toggle="members"]');
          toggle.checked = false;
          toggle.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 400; i++) {
            if (!document.body.inert && document.querySelector('.notice.error')?.textContent.includes('gespeichert')) break;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (!document.querySelector('.notice.error')?.textContent.includes('gespeichert') ||
              !document.querySelector('[data-module-toggle="members"]').checked ||
              !(await window.club.getModules()).members) {
            throw new Error('A failed selection save must show an error and retain the last valid selection');
          }
        })()`);
      } finally {
        await fs.rmdir(modulesFile);
        await fs.rename(savedModulesFile, modulesFile);
      }
      const initializationFolder = path.join(fixture, 'initialization-failure');
      await fs.mkdir(initializationFolder);
      selectedFolder = initializationFolder;
      const originalWriteFile = fs.writeFile;
      let failedInitializationWrites = 0;
      fs.writeFile = async (file, ...args) => {
        if (typeof file === 'string' && file.startsWith(path.join(initializationFolder, 'clubmanager-modules.json.')) && file.endsWith('.tmp')) {
          failedInitializationWrites++;
          const error = new Error('Simulierter Schreibfehler');
          error.code = 'EIO';
          throw error;
        }
        return originalWriteFile(file, ...args);
      };
      try {
        await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async test => {
            for (let i = 0; i < 400; i++) {
              if (await test()) return;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for initialization failure');
          };
          document.querySelector('[data-action="choose-folder"]').click();
          await waitFor(() => !document.body.inert && document.querySelector('.notice.error')?.textContent.includes('Simulierter Schreibfehler'));
          if (await window.club.getFolder() !== ${JSON.stringify(path.join(root, 'data'))} ||
              document.querySelector('[data-folder-switcher]').value !== ${JSON.stringify(path.join(root, 'data'))} ||
              !(await window.club.getModules()).members ||
              !document.querySelector('[data-module-toggle="members"]').checked ||
              document.querySelector('[data-module-toggle="members"]').disabled ||
              document.querySelector('[data-module-view="members"]').hidden ||
              !(await window.club.listMeetings()).length) {
            throw new Error('Initialization failure must retain the previous usable folder, selection and records');
          }
          if ((await window.club.getFolders()).dataFolders.some(item => item.path === ${JSON.stringify(initializationFolder)})) {
            throw new Error('An unsuccessfully initialized folder must not be registered');
          }
        })()`);
      } finally {
        fs.writeFile = originalWriteFile;
      }
      assert.equal(failedInitializationWrites, 1, 'The fixture must fail the initial selection write');
      assert.deepEqual(await fs.readdir(initializationFolder), [], 'A failed initialization must not create selection or module directories');
      await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-action="choose-folder"]').click();
        for (let i = 0; i < 400; i++) {
          if (await window.club.getFolder() === ${JSON.stringify(initializationFolder)} && !document.body.inert) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (await window.club.getFolder() !== ${JSON.stringify(initializationFolder)} ||
            !(await window.club.getModules()).meetings || (await window.club.getModules()).members ||
            document.querySelector('[data-folder-switcher]').value !== ${JSON.stringify(initializationFolder)}) {
          throw new Error('Retrying after an initialization failure must activate the new folder with its default selection');
        }
      })()`);
      assert.equal(await fs.readFile(path.join(brokenFolder, 'clubmanager-modules.json'), 'utf8'), '{');
      assert.ok(startupDialogs.some(item => item.detail?.includes('Modul-Einstellungen')), 'Configuration startup error must be shown');
      console.log('Electron configuration recovery smoke test passed: startup error, portability, failed activation and initialization-write recovery.');
      clearTimeout(timeout);
      app.exit(0);
      return;
    }
    await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async test => {
        for (let i = 0; i < 400; i++) {
          const value = await test();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timed out waiting for folder recovery UI');
      };
      await waitFor(() => document.querySelector('#app')?.dataset.modulesLoaded === 'true');
      if (await window.club.getFolder() !== null) {
        throw new Error('The unavailable active folder must not load at startup');
      }
      const startupFolders = await window.club.getFolders();
      if (startupFolders.activeFolder !== null || startupFolders.dataFolders.length !== 1 ||
          startupFolders.dataFolders[0].path !== ${JSON.stringify(unavailableFolder)} ||
          startupFolders.dataFolders[0].available !== false) {
        throw new Error('The unavailable folder must remain registered and inactive');
      }
      let activationError = '';
      try {
        await window.club.activateFolder(${JSON.stringify(unavailableFolder)});
      } catch (error) {
        activationError = error.message;
      }
      if (!activationError.includes('nicht verfügbar')) {
        throw new Error('The unavailable folder must not be activated');
      }
      if (!document.querySelector('[data-view="settings"]')) {
        throw new Error('Settings navigation is missing after recovery startup');
      }
      document.querySelector('[data-view="settings"]').click();
      await waitFor(() => document.querySelector('[data-action="relink-folder"]'));
      if (!document.querySelector('.folder-item.unavailable .status')?.textContent.includes('Nicht verfügbar')) {
        throw new Error('The unavailable folder must be clearly marked in Settings');
      }

      const confirm = window.confirm;
      window.confirm = () => true;
      document.querySelector('[data-action="relink-folder"]').click();
      await waitFor(async () => {
        const folders = await window.club.getFolders();
        return folders.dataFolders.some(item => item.path === ${JSON.stringify(restoredFolder)});
      });
      const relinked = await window.club.getFolders();
      const restored = relinked.dataFolders.find(item => item.path === ${JSON.stringify(restoredFolder)});
      if (!restored || restored.name !== 'Mein Verein' || !restored.available) {
        throw new Error('Relinking must restore availability and preserve the display name');
      }
      if (await window.club.getFolder() !== null) {
        throw new Error('Relinking must not implicitly activate the restored folder');
      }

      const switcher = document.querySelector('[data-folder-switcher]');
      switcher.value = ${JSON.stringify(restoredFolder)};
      switcher.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => window.club.getFolder().then(folder => folder === ${JSON.stringify(restoredFolder)}));
      const unregister = [...document.querySelectorAll('[data-action="unregister-folder"]')]
        .find(button => button.dataset.path === ${JSON.stringify(restoredFolder)});
      if (!unregister) throw new Error('The active folder cannot be unregistered from Settings');
    })()`);
    const contentsBeforeUnregister = await snapshotDirectory(restoredFolder);
    await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async test => {
        for (let i = 0; i < 400; i++) {
          const value = await test();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timed out waiting for unregister to finish');
      };
      const unregister = [...document.querySelectorAll('[data-action="unregister-folder"]')]
        .find(button => button.dataset.path === ${JSON.stringify(restoredFolder)});
      if (!unregister) throw new Error('The active folder cannot be unregistered from Settings');
      unregister.click();
      await waitFor(async () => {
        const folders = await window.club.getFolders();
        return await window.club.getFolder() === null &&
          folders.activeFolder === null &&
          !folders.dataFolders.some(item => item.path === ${JSON.stringify(restoredFolder)});
      });
      if (!document.querySelector('.notice')?.textContent.includes('Datenordner entfernt')) {
        throw new Error('Unregistering the active folder must guide the user');
      }
    })()`);
    assert.deepEqual(await snapshotDirectory(restoredFolder), contentsBeforeUnregister);

    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = () => {
        if (startupDialogs.some(item => item.detail?.includes('nicht verfügbar'))) return resolve();
        if (Date.now() >= deadline) return reject(new Error('The unavailable-folder startup warning was not shown.'));
        setTimeout(poll, 25);
      };
      poll();
    });

    await assert.rejects(fs.stat(unavailableFolder), { code: 'ENOENT' });
    assert.equal(await fs.readFile(markerFile, 'utf8'), 'folder contents survive unregister');
    const savedSettings = JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'));
    assert.deepEqual(savedSettings.dataFolders, []);
    assert.equal(savedSettings.activeFolder, null);
    await fs.rename(restoredFolder, movedFolder);
    selectedFolder = movedFolder;
    const reregisteredName = await window.webContents.executeJavaScript(`(async () => {
      await window.club.chooseFolder();
      const { dataFolders } = await window.club.getFolders();
      return dataFolders.find(item => item.path === ${JSON.stringify(movedFolder)})?.name;
    })()`);
    assert.equal(reregisteredName, 'Mein Verein', 'The name must survive unregistering, moving, and adding the folder again');

    const nameFile = path.join(movedFolder, 'clubmanager-folder.json');
    await fs.writeFile(nameFile, JSON.stringify({ version: 1, name: 'Anderer Name' }));
    const refreshedName = await window.webContents.executeJavaScript(`window.club.getFolders().then(
      ({ dataFolders }) => dataFolders.find(item => item.path === ${JSON.stringify(movedFolder)})?.name
    )`);
    assert.equal(refreshedName, 'Anderer Name', 'A saved name must take precedence over a stale registry name');

    await fs.writeFile(nameFile, 'invalid JSON');
    await window.webContents.executeJavaScript(`(async () => {
      const { dataFolders } = await window.club.getFolders();
      const item = dataFolders.find(item => item.path === ${JSON.stringify(movedFolder)});
      if (item?.name !== 'Anderer Name' || !item.nameWarning) {
        throw new Error('Invalid name metadata must be reported with the last known name still usable');
      }
      if (await window.club.getFolder() !== ${JSON.stringify(movedFolder)} ||
          !Array.isArray(await window.club.listMeetings())) {
        throw new Error('Invalid name metadata must not prevent access to club records');
      }
    })()`);
    assert.equal(await fs.readFile(nameFile, 'utf8'), 'invalid JSON', 'Invalid metadata must not be overwritten during refresh');
    console.log('Electron folder recovery smoke test passed: startup recovery, relinking, unregister, and portable display names.');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  app.exit(1);
});
