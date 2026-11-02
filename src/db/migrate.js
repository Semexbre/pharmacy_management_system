const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Applies every NNN_name.sql file newer than PRAGMA user_version, in order.
 * Each file runs in its own transaction together with the version bump,
 * so a failing migration leaves the DB exactly as it was.
 */
function migrate(db) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const current = db.pragma('user_version', { simple: true });

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= current) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
    console.log(`[pms] applied migration ${file}`);
  }
}

module.exports = { migrate };