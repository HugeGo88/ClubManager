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
  getFolder: () => invoke('folder:get'),
  chooseFolder: () => invoke('folder:choose'),
  listMeetings: () => invoke('meetings:list'),
  saveMeeting: (meeting, revision) => invoke('meetings:save', meeting, revision),
  exportMeeting: (meeting, revision) => invoke('meetings:export', meeting, revision),
  hasProtocol: id => invoke('meetings:has-protocol', id),
  openProtocol: id => invoke('meetings:open-protocol', id)
});
