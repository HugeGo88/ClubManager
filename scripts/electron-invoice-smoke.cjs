process.env.TZ = 'Europe/Berlin';

const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { invoiceDraftSmoke, invoicePaymentSmoke } = require('./electron-smoke.cjs');

let root;
process.on('exit', () => {
  if (root) fsSync.rmSync(root, { recursive: true, force: true });
});

const timeout = setTimeout(() => {
  console.error('Electron invoice smoke test timed out.');
  app.exit(1);
}, 60000);

async function runInvoiceRestartSmoke(rootPath, invoiceId, paidInvoiceId) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'electron-folder-recovery-smoke.cjs')], {
      env: {
        ...process.env,
        CLUBMANAGER_SMOKE_ROOT: rootPath,
        CLUBMANAGER_RECOVERY_MODE: 'invoice-restart-check',
        CLUBMANAGER_INVOICE_ID: invoiceId,
        CLUBMANAGER_PAID_INVOICE_ID: paidInvoiceId
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout + stderr);
      else reject(new Error(`Invoice restart smoke test failed (${code}):\n${stdout}${stderr}`));
    });
  });
  assert.match(output, /Electron invoice restart smoke test passed:/);
  process.stdout.write(output);
}

async function main() {
  app.setVersion(require('../package.json').version);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-invoice-electron-test-'));
  const data = path.join(root, 'data');
  const userData = path.join(root, 'settings');
  const invoiceDownloadPath = path.join(root, 'invoice-download.pdf');
  await Promise.all([
    fs.mkdir(userData, { recursive: true }),
    ...['meetings', 'members', 'invoices', 'letters', 'customizations']
      .map(directory => fs.mkdir(path.join(data, directory), { recursive: true }))
  ]);
  const modules = { meetings: true, members: false, invoices: true, letters: false };
  await fs.writeFile(path.join(data, 'clubmanager-modules.json'),
    `${JSON.stringify({ version: 1, modules }, null, 2)}\n`);
  await fs.writeFile(path.join(userData, 'settings.json'), `${JSON.stringify({
    dataFolders: [{ path: data, name: 'invoice-smoke', available: true, moduleSettingsKnown: true }],
    activeFolder: data,
    protocolCss: null,
    meetingTemplate: null,
    letterTemplate: null,
    modules,
    sidebarCollapsed: false,
    lastSeenVersion: app.getVersion()
  }, null, 2)}\n`);
  app.setPath('userData', userData);

  let invoiceSaveDialogOptions;
  dialog.showMessageBox = async () => ({ response: 0 });
  dialog.showSaveDialog = async (window, options) => {
    invoiceSaveDialogOptions = options;
    return { canceled: false, filePath: invoiceDownloadPath };
  };

  const windowReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The invoice smoke app window did not load.')), 20000);
    app.on('browser-window-created', (event, window) => {
      window.webContents.once('did-finish-load', () => {
        if (!window.webContents.getURL().endsWith('/renderer/index.html')) return;
        clearTimeout(timer);
        resolve(window);
      });
    });
  });
  require('../src/main/main');
  const window = await windowReady;
  await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 200 && document.querySelector('#app')?.dataset.modulesLoaded !== 'true'; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (document.querySelector('#app')?.dataset.modulesLoaded !== 'true' ||
        await window.club.getFolder() !== ${JSON.stringify(data)}) {
      throw new Error('The invoice smoke data folder did not load');
    }
  })()`);

  const invoice = await invoiceDraftSmoke(window);
  assert.deepEqual(await fs.readFile(invoiceDownloadPath), invoice.pdf);
  assert.equal(invoiceSaveDialogOptions.defaultPath, `${invoice.number}.pdf`);
  const paidInvoice = await invoicePaymentSmoke(window);
  await runInvoiceRestartSmoke(root, invoice.id, paidInvoice.id);
  console.log('Electron invoice smoke test passed: issue, artifact, payments, reload, preview, download and restart.');
  clearTimeout(timeout);
}

main().then(() => {
  app.exit(0);
}).catch(error => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
