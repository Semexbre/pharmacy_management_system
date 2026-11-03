// Clean the disposable Chromium profile after Electron has released its locks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-desktop-'));
const child = spawn(require('electron'), [path.join(__dirname, '..', 'tests', 'desktop.js')], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PMS_DESKTOP_TEST_DIR: dataDir },
});
child.on('error', err => { console.error(err); process.exitCode = 1; });
child.on('close', code => {
  process.exitCode = code ?? 1;
  const resolved = path.resolve(dataDir);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('pms-desktop-')) {
    throw new Error('Unexpected desktop test cleanup path');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
