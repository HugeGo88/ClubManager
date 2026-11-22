function performUpdateCheck({ updater }) {
  return new Promise((resolve) => {
    let resolved = false;

    const handleUpdateAvailable = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(true);
      }
    };

    const handleUpdateNotAvailable = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(false);
      }
    };

    const handleError = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(false);
      }
    };

    const cleanup = () => {
      updater.removeListener('update-available', handleUpdateAvailable);
      updater.removeListener('update-not-available', handleUpdateNotAvailable);
      updater.removeListener('error', handleError);
    };

    updater.on('update-available', handleUpdateAvailable);
    updater.on('update-not-available', handleUpdateNotAvailable);
    updater.on('error', handleError);

    updater.checkForUpdates().catch(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(false);
      }
    });
  });
}

function performUpdateInstall({ updater }) {
  return new Promise((resolve) => {
    let resolved = false;

    const handleUpdateDownloaded = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        updater.quitAndInstall(false, true);
        resolve(true);
      }
    };

    const handleError = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(false);
      }
    };

    const cleanup = () => {
      updater.removeListener('update-downloaded', handleUpdateDownloaded);
      updater.removeListener('error', handleError);
    };

    updater.on('update-downloaded', handleUpdateDownloaded);
    updater.on('error', handleError);
  });
}

function startUpdates({ updater, app, dialog, getWindow, getSplashWindow, platform = process.platform, autoInstall = false }) {
  if (!app.isPackaged || !['darwin', 'win32', 'linux'].includes(platform)) return;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  
  updater.on('checking-for-update', () => {
    if (autoInstall && getSplashWindow) {
      const splash = getSplashWindow();
      if (splash && !splash.isDestroyed()) {
        splash.webContents.send('splash:update-message', 'Prüfe auf Updates …');
      }
    }
  });
  
  updater.on('update-available', info => {
    if (autoInstall && getSplashWindow) {
      const splash = getSplashWindow();
      if (splash && !splash.isDestroyed()) {
        splash.webContents.send('splash:update-message', `Neue Version ${info.version} wird heruntergeladen …`);
      }
    }
  });
  
  updater.on('error', error => {
    console.error('Update fehlgeschlagen:', error);
    if (autoInstall && platform === 'linux') {
      const splash = getSplashWindow?.();
      const window = splash && !splash.isDestroyed() ? splash : getWindow();
      const options = {
        type: 'error', title: 'Update fehlgeschlagen',
        message: 'Das Update konnte nicht geprüft oder installiert werden.',
        detail: error.message, buttons: ['OK']
      };
      const shown = window && !window.isDestroyed()
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options);
      void shown.catch(dialogError => console.error('Fehlerdialog konnte nicht angezeigt werden:', dialogError));
    } else if (!autoInstall) {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        void dialog.showMessageBox(window, {
          type: 'error', title: 'Update fehlgeschlagen',
          message: 'Das Update konnte nicht geprüft oder heruntergeladen werden.',
          detail: error.message, buttons: ['OK']
        });
      }
    }
  });
  
  updater.on('update-downloaded', async info => {
    if (autoInstall) {
      if (getSplashWindow) {
        const splash = getSplashWindow();
        if (splash && !splash.isDestroyed()) {
          splash.webContents.send('splash:update-message', `Version ${info.version} wird installiert …`);
        }
      }
      updater.quitAndInstall(false, true);
      return;
    }
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(window, {
      type: 'info', title: 'Update verfügbar',
      message: `Version ${info.version} wurde heruntergeladen.`,
      detail: 'Jetzt installieren und ClubManager neu starten? Ungespeicherte Änderungen müssen vorher bestätigt werden.',
      buttons: ['Jetzt installieren', 'Später'], defaultId: 0, cancelId: 1, noLink: true
    });
    if (response !== 0 || window.isDestroyed()) return;
    window.webContents.send('update:prepare-install');
  });
  
  return updater.checkForUpdates()
    .then(result => result?.downloadPromise?.catch(error => {
      console.error('Update-Download fehlgeschlagen:', error);
    }))
    .catch(error => {
      console.error('Updateprüfung fehlgeschlagen:', error);
    });
}

module.exports = { startUpdates, performUpdateCheck, performUpdateInstall };
