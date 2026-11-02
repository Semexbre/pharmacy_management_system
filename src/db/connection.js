const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let db = null;

function openDb(dbPath) {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // SQLite does NOT enforce FKs unless asked, per connection
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialised. Call openDb() first.');
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { openDb, getDb, closeDb };