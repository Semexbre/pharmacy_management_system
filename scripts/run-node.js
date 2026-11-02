// Run server checks with the same Node runtime that powers the desktop app.
const { spawn } = require('child_process');
const child = spawn(require('electron'), process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
child.on('error', (err) => {
  console.error(err);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
