// Local recovery only: requires filesystem access to the application's database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const passwords = require('../src/security/passwords');

async function resetAdminPassword(filename, username = 'admin') {
  const dbPath = path.resolve(filename);
  const db = new Database(dbPath, { fileMustExist: true });
  let sessions;
  try {
    const user = db.prepare('SELECT id FROM users WHERE username = ? AND role = ? AND is_active = 1').get(username, 'admin');
    if (!user) throw new Error('Active admin account not found; no password changed.');
    const sessionsPath = path.join(path.dirname(dbPath), 'sessions.db');
    if (fs.existsSync(sessionsPath)) {
      sessions = new Database(sessionsPath, { fileMustExist: true });
      sessions.prepare('SELECT key FROM login_limits LIMIT 1').get();
    }
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `pharmacy-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.db`);
    await db.backup(backupPath);
    const temporaryPassword = crypto.randomBytes(18).toString('base64url');
    const result = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1,
      session_version = session_version + 1 WHERE id = ? AND role = 'admin' AND is_active = 1`)
      .run(passwords.hash(temporaryPassword), user.id);
    if (result.changes !== 1) throw new Error('Admin account changed during recovery; retry.');
    if (sessions) sessions.prepare('DELETE FROM login_limits WHERE key IN (?, ?, ?)')
      .run('127.0.0.1', '::ffff:127.0.0.1', '::1');
    const updated = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(user.id);
    if (!updated.must_change_password || !passwords.verify(temporaryPassword, updated.password_hash)) {
      throw new Error('Password reset verification failed.');
    }
    return { username, temporaryPassword, backupPath };
  } finally {
    if (sessions) sessions.close();
    db.close();
  }
}

if (require.main === module) {
  const [filename, username = 'admin'] = process.argv.slice(2);
  if (!filename) {
    console.error('Usage: node scripts/run-node.js scripts/reset-admin-password.js <database-path> [username]');
    process.exitCode = 1;
  } else {
    resetAdminPassword(filename, username).then(result => {
      console.log('Recovery backup:', result.backupPath);
      console.log('Username:', result.username);
      console.log('Temporary password:', result.temporaryPassword);
      console.log('Sign in and choose a new password when prompted.');
    }).catch(err => { console.error(err.message); process.exitCode = 1; });
  }
}
module.exports = { resetAdminPassword };
