function startUpdates({ updater, app, dialog, getWindow, platform = process.platform }) {
  if (!app.isPackaged || !['darwin', 'win32'].includes(platform)) return;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.on('error', error => {
    console.error('Update fehlgeschlagen:', error);
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      void dialog.showMessageBox(window, {
        type: 'error', title: 'Update fehlgeschlagen',
        message: 'Das Update konnte nicht geprüft oder heruntergeladen werden.',
        detail: error.message, buttons: ['OK']
      });
    }
  });
  updater.on('update-downloaded', async info => {
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
  updater.checkForUpdates()
    .then(result => result?.downloadPromise?.catch(error => {
      console.error('Update-Download fehlgeschlagen:', error);
    }))
    .catch(error => {
      console.error('Updateprüfung fehlgeschlagen:', error);
    });
}

module.exports = { startUpdates };
