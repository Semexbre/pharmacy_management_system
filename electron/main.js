const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { startServer } = require('../src/server');

let mainWindow = null;
let server = null;
let shuttingDown = false;

// Only one instance may run (later, two instances would fight over one SQLite file).
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(boot).catch(fatal);
}

async function boot() {
  const dbPath = path.join(app.getPath('userData'), 'pharmacy.db');
  console.log(`[pms] database: ${dbPath}`);

  server = await startServer({
    port: 0, host: '127.0.0.1', dbPath, dataDir: app.getPath('userData'),
    chooseBackupFolder: async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a backup destination (for example, a USB drive)',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    },
  });
  console.log(`[pms] server listening on http://127.0.0.1:${server.port}`);

  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow(server.port);
}
function createWindow(port) {
  const origin = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Pharmacy PMS',
    backgroundColor: '#f1f5f9',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep the window locked to our own server.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`${origin}/`);
}

// Quit fully when the window closes, on every platform (it's a POS terminal, not a document app).
app.on('window-all-closed', () => app.quit());

// Close the HTTP server cleanly before exiting.
app.on('before-quit', async (event) => {
  if (shuttingDown || !server) return;
  event.preventDefault();
  shuttingDown = true;
  try {
    await server.close();
  } finally {
    app.quit();
  }
});

function fatal(err) {
  console.error('[pms] fatal startup error:', err);
  dialog.showErrorBox('Pharmacy PMS failed to start', String(err && err.stack ? err.stack : err));
  app.exit(1);
}
