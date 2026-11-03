const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeStartupLog, writeStartupError } = require('../electron/diagnostics');
const { sessionSecret } = require('../src/security/sessionStore');

test('startup errors retain five redacted files and session secret survives restarts', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-packaging-'));
  try {
    const secret = sessionSecret(folder);
    assert.equal(secret.length, 96);
    assert.equal(sessionSecret(folder), secret);
    writeStartupLog(folder, ['database: test profile', 'server: loopback']);
    for (let i = 0; i < 8; i++) {
      const error = new Error('private password and SQL customer data');
      error.code = i % 2 ? 'SQLITE_CANTOPEN' : 'private-data';
      writeStartupError(folder, error, 'database');
    }
    const errors = fs.readdirSync(path.join(folder, 'logs')).filter(name => name.startsWith('startup-error-'));
    assert.equal(errors.length, 5);
    for (const file of errors) {
      const log = fs.readFileSync(path.join(folder, 'logs', file), 'utf8');
      assert.doesNotMatch(log, /private|password|SQL customer/);
      assert.match(log, /Code: (SQLITE_CANTOPEN|STARTUP_FAILED)/);
    }
    assert.equal(fs.existsSync(path.join(folder, 'logs', 'startup.log')), true);
  } finally {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(folder).startsWith('pms-packaging-'));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
