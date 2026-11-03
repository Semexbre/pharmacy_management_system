const { app, BrowserWindow, Menu, dialog } = require('electron');
app.setName('Pharmacy PMS');
const path = require('path');
const fs = require('fs');
const { writeStartupLog, writeStartupError } = require('./diagnostics');

let mainWindow = null;
let server = null;
let shuttingDown = false;
let shutdownComplete = false;
let stage = 'initialization';

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
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('logs', path.join(dataDir, 'logs'));
  const dbPath = path.join(dataDir, 'pharmacy.db');
  const startupLines = [`[pms] database: ${dbPath}`];
  const legacyDb = path.join(app.getPath('appData'), 'pharmacy-pms', 'pharmacy.db');
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
    const notice = '[pms] Legacy pharmacy-pms database found. No data was copied. See README for manual migration before using this new database.';
    console.log(notice);
    startupLines.push(notice);
  }
  writeStartupLog(dataDir, startupLines);
  console.log(`[pms] database: ${dbPath}`);

  stage = 'database';
  // Load native dependencies inside the startup error handler too.
  const { startServer } = require('../src/server');
  server = await startServer({
    port: 0, host: '127.0.0.1', dbPath, dataDir,
    chooseBackupFolder: async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a backup destination (for example, a USB drive)',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return null;
      const folder = result.filePaths[0];
      const appFolder = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
      const relative = path.relative(appFolder, folder);
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('Choose a backup destination outside the application folder.');
      }
      return folder;
    },
  });
  console.log(`[pms] server listening on http://127.0.0.1:${server.port}`);
  startupLines.push(`[pms] server listening on http://127.0.0.1:${server.port}`);
  writeStartupLog(dataDir, startupLines);

  if (app.isPackaged) Menu.setApplicationMenu(null);
  stage = 'window';
  await createWindow(server.port);
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
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      if (key === 'f12' || ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key))) event.preventDefault();
    });
  }

  // Keep the window locked to our own server.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow.loadURL(`${origin}/`);
}

// Quit fully when the window closes, on every platform (it's a POS terminal, not a document app).
app.on('window-all-closed', () => app.quit());

// Close the HTTP server cleanly before exiting.
app.on('before-quit', async (event) => {
  if (!server || shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server.close();
  } catch (err) {
    try { writeStartupError(app.getPath('userData'), err, 'shutdown'); } catch {}
  } finally {
    shutdownComplete = true;
    app.quit();
  }
});

function fatal(err) {
  try { writeStartupError(app.getPath('userData'), err, stage); } catch {}
  console.error('[pms] Startup failed. Check the startup-error logs in the application data folder.');
  dialog.showErrorBox('Pharmacy PMS could not start',
    'Please close the app and try again. If the problem continues, check that your data folder is writable and share the startup-error log from the logs folder with support. Your pharmacy data has not been reset.');
  process.exitCode = 1;
  app.quit();
}
