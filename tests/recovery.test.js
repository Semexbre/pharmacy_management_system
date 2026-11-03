const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { LocalSessionStore } = require('../src/security/sessionStore');
const passwords = require('../src/security/passwords');
const { resetAdminPassword } = require('../scripts/reset-admin-password');

test('local admin recovery preserves data, backs up, revokes sessions and clears the local lockout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-recovery-'));
  const filename = path.join(dir, 'pharmacy.db');
  const db = new Database(filename);
  const store = new LocalSessionStore(path.join(dir, 'sessions.db'));
  try {
    db.pragma('journal_mode = WAL');
    migrate(db);
    seed(db);
    db.exec("INSERT INTO medicines (name) VALUES ('Keep inventory')");
    const before = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    for (let i = 0; i < 10; i++) store.loginAttempt('127.0.0.1');
    assert.ok(store.loginAttempt('127.0.0.1') > 0);
    await assert.rejects(resetAdminPassword(filename, 'missing'), /not found/);
    const result = await resetAdminPassword(filename);
    const after = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    assert.ok(passwords.verify(result.temporaryPassword, after.password_hash));
    assert.equal(after.must_change_password, 1);
    assert.equal(after.session_version, before.session_version + 1);
    assert.equal(after.role, before.role);
    assert.equal(store.loginAttempt('127.0.0.1'), 0);
    assert.equal(db.prepare('SELECT name FROM medicines').pluck().get(), 'Keep inventory');
    const backup = new Database(result.backupPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(backup.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(before.id), before.password_hash);
      assert.equal(backup.prepare('SELECT name FROM medicines').pluck().get(), 'Keep inventory');
    } finally { backup.close(); }
  } finally {
    store.close();
    db.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dir).startsWith('pms-recovery-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
