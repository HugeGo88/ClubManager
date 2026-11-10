const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('club', {
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  saveMeeting: (meeting, revision) => ipcRenderer.invoke('meetings:save', meeting, revision),
  exportMeeting: (meeting, revision) => ipcRenderer.invoke('meetings:export', meeting, revision)
});
