const { ipcRenderer } = require('electron');

let message = '';
function showMessage() {
  const element = document.getElementById('message');
  if (element) element.textContent = message;
}

ipcRenderer.on('splash:update-message', (_event, text) => {
  message = text;
  showMessage();
});
window.addEventListener('DOMContentLoaded', showMessage);
