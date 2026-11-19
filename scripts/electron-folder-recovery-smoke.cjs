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

async function main() {
  const root = process.env.CLUBMANAGER_SMOKE_ROOT;
  if (!root) throw new Error('CLUBMANAGER_SMOKE_ROOT is required.');

  app.setVersion(require('../package.json').version);
  const fixture = path.join(root, 'folder-recovery');
  const userData = path.join(fixture, 'settings');
  const unavailableFolder = path.join(fixture, 'missing-club');
  const restoredFolder = path.join(fixture, 'restored-club');
  const markerFile = path.join(restoredFolder, 'keep.txt');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(restoredFolder, { recursive: true });
  await fs.writeFile(markerFile, 'folder contents survive unregister');
  app.setPath('userData', userData);

  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    dataFolders: [{ path: unavailableFolder, name: 'Mein Verein', available: true }],
    activeFolder: unavailableFolder,
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
  dialog.showOpenDialog = async (window, options) => {
    if (!options.properties.includes('openDirectory')) {
      throw new Error(`Unexpected folder-recovery dialog: ${options.title}`);
    }
    return { canceled: false, filePaths: [restoredFolder] };
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
    console.log('Electron folder recovery smoke test passed: startup recovery, relinking, and non-destructive unregister.');
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
