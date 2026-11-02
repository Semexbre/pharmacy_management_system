const bcrypt = require('bcryptjs');

/** Creates the first-run admin; the schema requires a password change at login. */
function seed(db) {
  const count = db.prepare('SELECT COUNT(*) FROM users').pluck().get();
  if (count > 0) return;

  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    `INSERT INTO users (username, full_name, password_hash, role)
     VALUES ('admin', 'Administrator', ?, 'admin')`
  ).run(hash);
  console.log('[pms] created first-run admin; password change required');
}

module.exports = { seed };
