const session = require('express-session');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LocalSessionStore extends session.Store {
  constructor(filename) {
    super();
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);`);
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref();
    this.prune();
  }
  prune() {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    this.db.prepare('DELETE FROM login_limits WHERE expires <= ?').run(Date.now());
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT value FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.value) : null);
    } catch (err) { cb(err); }
  }
  set(sid, value, cb = () => {}) {
    try {
      this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)').run(sid, JSON.stringify(value), new Date(value.cookie.expires).getTime());
      cb();
    } catch (err) { cb(err); }
  }
  touch(sid, value, cb = () => {}) {
    try { this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(new Date(value.cookie.expires).getTime(), sid); cb(); }
    catch (err) { cb(err); }
  }
  destroy(sid, cb = () => {}) {
    try { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(); } catch (err) { cb(err); }
  }
  clear(cb = () => {}) {
    try { this.db.exec('DELETE FROM sessions'); cb(); } catch (err) { cb(err); }
  }
  loginAttempt(key, now = Date.now()) {
    this.db.prepare('DELETE FROM login_limits WHERE expires <= ?').run(now);
    const row = this.db.prepare('SELECT * FROM login_limits WHERE key = ?').get(key);
    if (row && row.attempts >= 10) return Math.ceil((row.expires - now) / 1000);
    this.db.prepare(`INSERT INTO login_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1`).run(key, now + 15 * 60000);
    return 0;
  }
  close() { clearInterval(this.timer); this.db.close(); }
}
function sessionSecret(dataDir) {
  if (!dataDir) return crypto.randomBytes(48).toString('hex');
  const filename = path.join(dataDir, 'session-secret');
  try { fs.writeFileSync(filename, crypto.randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  const secret = fs.readFileSync(filename, 'utf8');
  if (secret.length < 64) throw new Error('Invalid local session secret');
  return secret;
}
module.exports = { LocalSessionStore, sessionSecret };
