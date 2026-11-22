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

ipcRenderer.on('splash:error-message', (_event, data) => {
  if (!data || !data.message) return;
  
  const errorDisplay = document.getElementById('error-display');
  const errorMessage = document.getElementById('error-message');
  const okButton = document.getElementById('ok-button');
  
  if (errorMessage) {
    errorMessage.textContent = data.message;
  }
  if (errorDisplay) {
    errorDisplay.classList.add('show');
  }
  if (okButton) {
    okButton.classList.add('show');
  }
});

function setupOkButton() {
  const okButton = document.getElementById('ok-button');
  if (!okButton || typeof okButton.addEventListener !== 'function') return;
  
  const handleOk = () => {
    ipcRenderer.send('splash:error-acknowledged');
  };
  
  okButton.addEventListener('click', handleOk);
  okButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleOk();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  showMessage();
  setupOkButton();
});
