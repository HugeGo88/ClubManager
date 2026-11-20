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
  getManual: () => invoke('manual:get'),
  getChangelog: () => invoke('changelog:get'),
  shouldShowChangelog: () => invoke('changelog:should-show'),
  markChangelogSeen: () => invoke('changelog:mark-seen'),
  getFolder: () => invoke('folder:get'),
  getFolders: () => invoke('folders:get'),
  activateFolder: folder => invoke('folder:activate', folder),
  renameFolder: (folder, name) => invoke('folder:rename', folder, name),
  relinkFolder: folder => invoke('folder:relink', folder),
  unregisterFolder: folder => invoke('folder:unregister', folder),
  getModules: () => invoke('modules:get'),
  reloadModules: () => invoke('modules:reload'),
  setModules: (modules, base) => invoke('modules:set', modules, base),
  getSidebarCollapsed: () => invoke('sidebar:get'),
  setSidebarCollapsed: collapsed => invoke('sidebar:set', collapsed),
  chooseFolder: () => invoke('folder:choose'),
  getProtocolCss: () => invoke('protocol-css:get'),
  chooseProtocolCss: () => invoke('protocol-css:choose'),
  resetProtocolCss: () => invoke('protocol-css:reset'),
  getMeetingTemplate: () => invoke('meeting-template:get'),
  chooseMeetingTemplate: () => invoke('meeting-template:choose'),
  resetMeetingTemplate: () => invoke('meeting-template:reset'),
  getLetterSettings: () => invoke('letter-settings:get'),
  chooseLetterTemplate: () => invoke('letter-template:choose'),
  resetLetterTemplate: () => invoke('letter-template:reset'),
  saveLetterPlaceholders: (placeholders, base) => invoke('letter-placeholders:set', placeholders, base),
  openCustomizationDirectory: () => invoke('customizations:open'),
  chooseSignature: () => invoke('signatures:choose'),
  removeSignature: id => invoke('signatures:remove', id),
  listLetters: () => invoke('letters:list'),
  saveLetter: (letter, revision) => invoke('letters:save', letter, revision),
  exportLetter: (letter, revision) => invoke('letters:export', letter, revision),
  hasLetterPdf: id => invoke('letters:has-pdf', id),
  openLetterPdf: id => invoke('letters:open-pdf', id),
  previewLetterPdf: id => invoke('letters:preview-pdf', id),
  listMeetings: () => invoke('meetings:list'),
  saveMeeting: (meeting, revision) => invoke('meetings:save', meeting, revision),
  exportMeeting: (meeting, revision, includeEarlierTasks) => invoke('meetings:export', meeting, revision, includeEarlierTasks),
  onPrepareUpdate: callback => ipcRenderer.on('update:prepare-install', () => callback()),
  installUpdate: () => invoke('update:install'),
  hasProtocol: id => invoke('meetings:has-protocol', id),
  previewProtocol: id => invoke('meetings:preview-protocol', id),
  openProtocol: id => invoke('meetings:open-protocol', id)
});
