const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeStartupLog(dataDir, lines) {
  const folder = path.join(dataDir, 'logs');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'startup.log'), lines.join('\n') + '\n', { mode: 0o600 });
}
function writeStartupError(dataDir, error, phase) {
  const folder = path.join(dataDir, 'logs');
  fs.mkdirSync(folder, { recursive: true });
  // Never persist exception messages/stacks: they can contain SQL or user data.
  const allowed = ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EADDRINUSE', 'SQLITE_CANTOPEN', 'SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_BUSY'];
  const code = allowed.includes(error?.code) ? error.code : 'STARTUP_FAILED';
  const stage = ['initialization', 'database', 'window', 'shutdown'].includes(phase) ? phase : 'initialization';
  const filename = `startup-error-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.log`;
  fs.writeFileSync(path.join(folder, filename), `Time: ${new Date().toISOString()}\nStage: ${stage}\nCode: ${code}\n`, { mode: 0o600 });
  const errors = fs.readdirSync(folder).filter(name => /^startup-error-[\dTZ-]+-[a-f0-9]{8}\.log$/.test(name)).sort().reverse();
  for (const name of errors.slice(5)) fs.unlinkSync(path.join(folder, name));
}
module.exports = { writeStartupLog, writeStartupError };
