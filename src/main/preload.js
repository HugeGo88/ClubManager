const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    const systemErrors = {
      ENOENT: 'Datei oder Ordner nicht gefunden',
      EACCES: 'Zugriff verweigert',
      EPERM: 'Vorgang nicht erlaubt',
      ENOSPC: 'Nicht genügend Speicherplatz',
      EROFS: 'Der Speicherort ist schreibgeschützt'
    };
    const code = /^([A-Z]+):/.exec(message)?.[1];
    throw new Error(code && systemErrors[code] ? `${systemErrors[code]} (${message})` : message);
  }
}

contextBridge.exposeInMainWorld('club', {
  awaitStartup: () => invoke('app:startup'),
  startupComplete: () => ipcRenderer.send('app:startup-complete'),
  getVersion: () => invoke('app:version'),
  getChangelog: () => invoke('changelog:get'),
  shouldShowChangelog: () => invoke('changelog:should-show'),
  markChangelogSeen: () => invoke('changelog:mark-seen'),
  getFolder: () => invoke('folder:get'),
  getModules: () => invoke('modules:get'),
  setModules: modules => invoke('modules:set', modules),
  chooseFolder: () => invoke('folder:choose'),
  getProtocolCss: () => invoke('protocol-css:get'),
  chooseProtocolCss: () => invoke('protocol-css:choose'),
  resetProtocolCss: () => invoke('protocol-css:reset'),
  listMeetings: () => invoke('meetings:list'),
  saveMeeting: (meeting, revision) => invoke('meetings:save', meeting, revision),
  exportMeeting: (meeting, revision, includeEarlierTasks) => invoke('meetings:export', meeting, revision, includeEarlierTasks),
  onPrepareUpdate: callback => ipcRenderer.on('update:prepare-install', () => callback()),
  installUpdate: () => invoke('update:install'),
  hasProtocol: id => invoke('meetings:has-protocol', id),
  previewProtocol: id => invoke('meetings:preview-protocol', id),
  openProtocol: id => invoke('meetings:open-protocol', id)
});
